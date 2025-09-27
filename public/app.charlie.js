const BASE = location.origin;
const $ = s => document.querySelector(s);
const setStatus = m => $("#status").textContent = m;

async function api(path, opts={}){
  const res = await fetch(`${BASE}${path}`, { ...opts, headers:{'Content-Type':'application/json'} });
  return res.json();
}

async function fetchDevices(){
  try {
    const j = await api('/api/devicedatas');
    const list = j?.data || [];
    setStatus(`Found ${list.length} device(s).`);
    render(list);
  } catch(e){
    setStatus(`Error loading devices: ${e.message}`);
  }
}

function buildHex12(p){ const v=x=>Math.round(x*255/100).toString(16).padStart(2,'0').toUpperCase(); return `${v(p)}${v(p)}${v(p)}${v(p)}0000`; }

async function patch(id, body){
  const res = await fetch(`/api/devicedatas/device/${id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return res.json();
}

function deviceCard(dev){
  const c=document.createElement('div'); c.className='card';
  c.innerHTML = `<b>${dev.deviceName||'Device '+dev.id}</b> — ${dev.onOffStatus?'ON':'OFF'}<br>`;
  const on=document.createElement('button'); on.textContent='ON (Safe)';
  const off=document.createElement('button'); off.textContent='OFF';
  on.onclick=()=>patch(dev.id,{status:"on",value:buildHex12(45)}).then(()=>setStatus(`${dev.deviceName} ON`));
  off.onclick=()=>patch(dev.id,{status:"off",value:null}).then(()=>setStatus(`${dev.deviceName} OFF`));
  c.append(on,off);
  return c;
}

function render(devs){ const h=$("#devices"); h.innerHTML=''; devs.forEach(d=>h.append(deviceCard(d))); }

document.addEventListener('DOMContentLoaded', ()=>{
  $('#refresh').onclick=fetchDevices;
  $('#allOn').onclick=()=>api('/api/devicedatas').then(j=>Promise.all(j.data.map(d=>patch(d.id,{status:"on",value:buildHex12(45)})))).then(()=>setStatus("All ON Safe"));
  $('#allOff').onclick=()=>api('/api/devicedatas').then(j=>Promise.all(j.data.map(d=>patch(d.id,{status:"off",value:null})))).then(()=>setStatus("All OFF"));
  fetchDevices();
});
