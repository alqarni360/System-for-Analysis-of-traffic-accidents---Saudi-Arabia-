// ضبط عامل PDF.js
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }

  // خريطة
  const map = L.map('map').setView([24.75, 46.75], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

  let heatLayer = null;
  let markersLayer = L.layerGroup().addTo(map);
  let aggregatedPoints = []; // ستحتوي على النقاط المجمعة مع attributes
  let lastAggregatedData = []; // To store data for AI analysis

  // دوال مفيدة
  function setStatus(txt){ document.getElementById('status').innerText = txt; console.log(txt); }
  function parseCoordsFromText(text){
    const regex = /([0-9]{1,2}\.[0-9]+)\s*,\s*([0-9]{1,2}\.[0-9]+)/g;
    const out = []; let m;
    while((m = regex.exec(text)) !== null){
      out.push([parseFloat(m[1]), parseFloat(m[2])]);
    }
    return out;
  }

  async function extractCoordsFromPdfArrayBuffer(ab){
    const typed = new Uint8Array(ab);
    const pdf = await pdfjsLib.getDocument(typed).promise;
    let fullText = '';
    for(let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      content.items.forEach(it => fullText += it.str + ' ');
    }
    return parseCoordsFromText(fullText);
  }

  // إنشاء attributes لخريطة
  function createMapAttributes(cell){
    const count = cell.count;
    let risk = 'low';
    if (count >= 100 && count <= 500) risk = 'medium';
    else if (count > 500) risk = 'critical';

    let color = '#00f0ff';
    if (risk === 'medium') color = '#ffd700';
    if (risk === 'critical') color = '#ff4dd2';

    const heatIntensity = Math.min(1, count / 500);

    return { accidentCount: count, riskLevel: risk, colorClass: color, heatIntensity };
  }

  // تجميع نقاط قريبة (شبكة تقريبية 0.001 درجة ≈ 111 م)
  function aggregate(rawPoints){
    const cells = new Map();
    rawPoints.forEach(([lat,lng])=>{
      const key = Math.round(lat*1000) + '_' + Math.round(lng*1000);
      const cell = cells.get(key) || {lat, lng, count:0};
      cell.count++;
      cells.set(key, cell);
    });
    const arr = Array.from(cells.values()).map((c,i)=>{
      const attrs = createMapAttributes(c);
      return { id:i, lat:c.lat, lng:c.lng, count:c.count, ...attrs };
    });
    return arr;
  }

  // تنظيف الطبقات القديمة
  function clearLayers(){
    if (heatLayer){ try{ map.removeLayer(heatLayer); }catch(e){} heatLayer = null; }
    markersLayer.clearLayers();
  }

  // عرض Heat + Markers + Popups
  function renderMap(points){
    clearLayers();
    aggregatedPoints = points;

    // Heat
    const heatPts = points.map(p => [p.lat, p.lng, p.heatIntensity]);
    heatLayer = L.heatLayer(heatPts, { radius: 30, blur: 20, maxZoom: 17 }).addTo(map);

    // Markers and popups
    points.forEach(p => {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: Math.min(12, 4 + Math.log(p.count + 1) * 2),
        color: '#081018',
        fillColor: p.colorClass,
        fillOpacity: 0.95,
        weight: 1
      }).addTo(markersLayer);

      const popup = `
        <div style="direction:rtl;text-align:right">
          <strong>عدد الحوادث:</strong> ${p.accidentCount}<br>
          <strong>مستوى الخطورة:</strong> ${p.riskLevel}<br>
          <strong>Heat intensity:</strong> ${p.heatIntensity.toFixed(2)}
        </div>
      `;
      marker.bindPopup(popup);
    });

    // تحديث الإحصاءات والقائمة
    document.getElementById('totalCount').innerText = points.reduce((s,p)=>s+p.accidentCount,0);
    document.getElementById('hotspotsCount').innerText = points.filter(p=>p.accidentCount>100).length;
    updateHotspotList();
  }

  function updateHotspotList(){
    const el = document.getElementById('hotspotList');
    el.innerHTML = '';
    const sorted = aggregatedPoints.slice().sort((a,b)=>b.accidentCount - a.accidentCount).slice(0,15);
    sorted.forEach((p,i)=>{
      const div = document.createElement('div'); div.className='hot-item';
      const left = document.createElement('div'); left.innerHTML = `${i+1}. موقع ${p.id}`;
      const right = document.createElement('div'); right.innerHTML = `<strong style="color:${p.colorClass}">${p.accidentCount}</strong>`;
      div.appendChild(left); div.appendChild(right); el.appendChild(div);
    });
  }

  // تصدير CSV للنقاط المجمعة
  function exportCSV(){
    if (!aggregatedPoints || aggregatedPoints.length===0){ alert('لا توجد نقاط للتصدير'); return; }
    const rows = [['id','lat','lng','accidentCount','riskLevel','heatIntensity']];
    aggregatedPoints.forEach(p => rows.push([p.id,p.lat,p.lng,p.accidentCount,p.riskLevel,p.heatIntensity.toFixed(3)]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'hotspots.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // MAIN: معالجة الملفات
  document.getElementById('btnProcess').addEventListener('click', async ()=>{
    setStatus('جاري المعالجة — الرجاء الانتظار...');
    const input = document.getElementById('pdfFiles');
    let rawCoords = [];

    try {
      if (input.files && input.files.length > 0){
        for (const f of input.files){
          const ab = await f.arrayBuffer();
          const coords = await extractCoordsFromPdfArrayBuffer(ab);
          setStatus(`قراءة ${f.name} — الإحداثيات المستخرجة: ${coords.length}`);
          rawCoords.push(...coords);
        }
      } else {
        // استخدام ملف العينة المحلي (مسار السيرفر/المحلي)
        const sample = '/mnt/data/321ea7f4-241b-49ff-b973-674d0aaaf35b.pdf';
        setStatus('لم ترفع ملفات — محاولة استخدام ملف العينة المحلي...');
        const resp = await fetch(sample);
        if (!resp.ok) throw new Error('فشل الوصول لملف العينة: ' + resp.status);
        const ab = await resp.arrayBuffer();
        const coords = await extractCoordsFromPdfArrayBuffer(ab);
        setStatus(`ملف العينة: الإحداثيات المستخرجة ${coords.length}`);
        rawCoords.push(...coords);
      }

      if (rawCoords.length === 0){
        setStatus('لم يتم العثور على أي إحداثيات.');
        return;
      }

      lastAggregatedData = aggregate(rawCoords);
      renderMap(lastAggregatedData);

      // ضبط الحد بناءً على نقاط البيانات
      const bounds = L.latLngBounds(rawCoords.map(c=>[c[0],c[1]]));
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.35));

      setStatus('اكتمل التحليل. يمكنك الآن طلب تحليل الأنماط.');
      document.getElementById('aiAnalysisContainer').style.display = 'block'; // Show AI button

    } catch (err){
      console.error(err);
      setStatus('خطأ أثناء المعالجة — افتح Console للمزيد');
      alert('حدث خطأ: ' + (err.message || err));
    }
  });

  document.getElementById('btnAnalyzeAI').addEventListener('click', async () => {
    if (lastAggregatedData.length === 0) {
      alert('لا توجد بيانات لتحليلها. يرجى معالجة بعض الملفات أولاً.');
      return;
    }

    const aiResultDiv = document.getElementById('aiResult');
    aiResultDiv.innerHTML = '<h5><i class="fas fa-spinner fa-spin"></i> جاري تحليل الأنماط...</h5>';

    // IMPORTANT: In a real-world application, this key should be handled securely
    // and not exposed on the client-side.
    const apiKey = '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';
    const apiEndpoint = 'https://api.openai.com/v1/chat/completions';

    const systemPrompt = `You are an expert urban safety planner and traffic analyst advising a government ministry.
      You will be given a JSON array of aggregated accident data. The data represents hotspots, where 'lat' and 'lng' are the coordinates, 'count' is the number of **extracted coordinate entries** at that location, and 'riskLevel' is a calculated risk ('critical', 'medium', 'low').
      **Important Context:** Each processed PDF file represents a single accident incident, even if that file contains multiple coordinate entries. Therefore, while 'count' reflects coordinate density, the underlying incident count might be lower if multiple coordinates originated from the same PDF. Interpret the data with this nuance in mind for policy recommendations.
      Your task is to provide a formal, actionable report for policy-makers.

      Please structure your response in Arabic with the following sections, using markdown for formatting:

      - **ملخص تنفيذي (Executive Summary):** A high-level overview of the findings for decision-makers.
      - **نقاط الاشتعال ذات الأولوية (Priority Hotspots):** Identify the top 3 most critical hotspots that require immediate attention. For each one, list its ID, accident count (number of coordinate entries), and risk level.
      - **تحليل العوامل المحتملة (Analysis of Potential Factors):** For each of the top 3 hotspots, hypothesize potential underlying causes for the high accident rate, considering that multiple coordinate entries might originate from a single accident incident. Examples: "This intersection may lack adequate lighting," or "The high count on this road segment could be due to excessive speed and a lack of traffic calming measures."
      - **توصيات استراتيجية قابلة للتنفيذ (Actionable Strategic Recommendations):** For each of the top 3 hotspots, provide a concrete, strategic recommendation for a ministry to act upon. Examples: "Recommendation for Hotspot #1: Dispatch a civil engineering team to assess the feasibility of installing a roundabout." or "Recommendation for Hotspot #2: Increase traffic police patrols during evening peak hours (4 PM - 7 PM) to enforce speed limits."`;
      
    const userPrompt = `
      Data (sample of up to 20 hotspots):
      ${JSON.stringify(lastAggregatedData.slice(0, 20), null, 2)}
    `;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
          ],
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`AI API call failed with status: ${response.status}. Body: ${JSON.stringify(errorBody)}`);
      }

      const result = await response.json();
      
      if (!result.choices || !result.choices[0].message || !result.choices[0].message.content) {
        throw new Error('Invalid AI response format.');
      }

      const analysisText = result.choices[0].message.content;

      // Convert simple markdown to HTML for display
      let formattedText = analysisText
        .replace(/\*\*(.*?)\*\*/g, '<h5>$1</h5>')
        .replace(/-\s(.*?)(?=\n-|\n\n|$)/g, '<li>$1</li>');
      
      // Wrap list items in a <ul>
      formattedText = formattedText.replace(/<li>/g, '<ul><li>').replace(/<\/li>/g, '</li></ul>').replace(/<\/ul>\s*<ul>/g, '');


      aiResultDiv.innerHTML = formattedText;

    } catch (error) {
      console.error('Error during AI analysis:', error);
      aiResultDiv.innerHTML = `<p style="color:var(--neon-pink);">فشل تحليل الذكاء الاصطناعي. يرجى التحقق من وحدة التحكم للحصول على التفاصيل.</p>`;
    }
  });

  document.getElementById('exportCSV').addEventListener('click', exportCSV);

  // Handle file input change to display selected file names
  document.getElementById('pdfFiles').addEventListener('change', function() {
    const fileNameEl = document.getElementById('fileName');
    if (this.files && this.files.length > 1) {
      fileNameEl.textContent = `${this.files.length} ملفات تم اختيارها`;
    } else if (this.files && this.files.length === 1) {
      fileNameEl.textContent = this.files[0].name;
    } else {
      fileNameEl.textContent = 'لم يتم اختيار ملفات';
    }
  });

  console.log('واجهة الخريطة جاهزة');
