(function(){
  const status=$('#healthConnectStatus'),detail=$('#healthConnectDetail'),btn=$('#healthConnectBtn'),syncBtn=$('#healthSyncBtn'),last=$('#healthLastSync');
  function setState(label,msg,kind='medium'){if(status)status.textContent=label;if(detail)detail.textContent=msg;const dot=$('#healthConnectDot');if(dot)dot.className='dot '+kind}
  function mergeActivities(incoming){if(!Array.isArray(incoming)||!incoming.length)return 0;let added=0;incoming.forEach(n=>{const key=n.sourceId||`${n.date}-${n.sport}-${n.duration}`;const idx=activities.findIndex(a=>(a.sourceId||`${a.date}-${a.sport}-${a.duration}`)===key);if(idx>=0)activities[idx]={...activities[idx],...n};else{activities.push(n);added++}});localStorage.setItem(KEY,JSON.stringify(activities));return added}
  window.onEntrenaHealthEvent=function(e){
    if(!e)return;
    if(e.type==='permissions'){setState(e.granted?'Conectado':'Permisos pendientes',e.granted?'Health Connect autorizado.':'Necesito permiso para leer tus datos.',e.granted?'good':'medium');return}
    if(e.type==='need_permissions'){setState('Permisos pendientes','Pulsa Conectar para autorizar Health Connect.','medium');return}
    if(e.type==='error'){setState('No disponible',e.message||'No se pudo conectar.','bad');return}
    if(e.type==='sync'){
      const added=mergeActivities(e.activities||[]),r=recoveryData();
      if(e.restingHr)r.rest=Number(e.restingHr);
      if(e.sleepHours)r.sleepHours=Number(e.sleepHours);
      r.date=new Date().toISOString();
      localStorage.setItem(REC,JSON.stringify(r));
      if(e.restingHr&&$('#restingHr'))$('#restingHr').value=e.restingHr;
      if(e.sleepHours&&$('#sleepHours'))$('#sleepHours').value=Number(e.sleepHours).toFixed(1);
      if($('#healthSteps'))$('#healthSteps').textContent=(e.stepsToday||0).toLocaleString('es-ES');
      if(last)last.textContent=new Date(e.syncedAt).toLocaleString('es-ES',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
      setState('Sincronizado',`${added?added+' actividad(es) nueva(s). ':''}Datos leídos de Health Connect.`, 'good');
      render();
    }
  };
  function native(){return typeof EntrenaHealth!=='undefined'}
  function refreshStatus(){
    if(!native()){setState('Solo Android','Esta función está disponible en la APK de Entrena360.','medium');return}
    try{const s=JSON.parse(EntrenaHealth.getStatus());if(s.available)setState('Listo para conectar','Autoriza una vez y después Entrena360 se sincronizará al abrirse.','medium');else setState('No disponible',s.needsUpdate?'Actualiza Health Connect.':'Este teléfono no ofrece Health Connect compatible.','bad')}catch(_){setState('Error','No pude consultar Health Connect.','bad')}
  }
  if(btn)btn.onclick=()=>{if(native())EntrenaHealth.requestPermissions()};
  if(syncBtn)syncBtn.onclick=()=>{if(native()){setState('Sincronizando','Buscando datos nuevos de Garmin…','medium');EntrenaHealth.syncNow()}};
  refreshStatus();
})();
