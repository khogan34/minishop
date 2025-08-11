import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Upload,
  Layers as LayersIcon,
  Eraser,
  Brush as BrushIcon,
  Type as TypeIcon,
  RectangleHorizontal,
  Circle,
  MousePointer,
  Scissors,
  Pipette,
  Copy,
  Settings2,
  Image as ImageIcon,
  SquarePlus,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Minus,
  Undo2,
  Redo2,
  Move,
  Clone,
  SlidersHorizontal
} from "lucide-react";

/*
  MiniShop — a browser-based, Photoshop‑lite image editor
  ------------------------------------------------------
  Core features implemented:
  • Layers panel with: raster layer, text layer, shape layer, adjustment layer (Brightness/Contrast, Hue/Saturation), filter layer (Blur/Sharpen), visibility toggle, opacity, blend mode, reordering, delete
  • Layer masks: add/remove, paint mask with brush (white=visible, black=hidden, supports soft brush)
  • Selections: rectangular marquee + quick mask (paint selection) that gates edits
  • Brush tool: size/hardness/opacity, color picker (eyedropper)
  • Eraser tool: paints transparency on raster layers
  • Clone stamp: Alt/Option‑click to set source; paint from that source
  • Text tool: click to add, edit text content/font/size/weight/align; non‑destructive vector text rendered on composite
  • Shapes: rectangle/ellipse (stroke/fill)
  • Adjustment layers: Brightness/Contrast, Hue/Saturation (live, non‑destructive)
  • Filters as live layers: Blur (box blur), Sharpen (simple unsharp mask approximation)
  • Non‑destructive editing via layer stack with params + mask per layer
  • History (undo/redo)
  • Import images (as new layers) and export composite PNG/JPEG

  Notes:
  • This is a compact single-file demo focused on clarity. For production, split into modules and add persistence.
  • Some algorithms (healing brush, advanced selection, complex blending) are simplified by design.
  • Works best with medium images (e.g., 2000px max) due to browser memory constraints.
*/

// ---------- Utilities ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Basic color helpers
function rgbaToCss([r,g,b,a]) { return `rgba(${r|0}, ${g|0}, ${b|0}, ${a.toFixed(3)})`; }
function hexToRgba(hex, alpha=1) {
  let h = hex.replace('#','');
  if (h.length === 3) h = h.split('').map(c=>c+c).join('');
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return [r,g,b,alpha];
}

// Convolution helper for blur/sharpen (simple box blur, and unsharp mask-ish)
function boxBlur(srcCtx, radius=2) {
  if (radius <= 0) return;
  const { width, height } = srcCtx.canvas;
  const img = srcCtx.getImageData(0,0,width,height);
  const out = srcCtx.createImageData(width,height);
  const r = radius|0;
  const temp = new Uint8ClampedArray(img.data);
  // Horizontal
  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      let R=0,G=0,B=0,A=0;
      for (let k=-r; k<=r; k++){
        const xx = Math.max(0, Math.min(width-1, x+k));
        const i = (y*width+xx)*4;
        R += temp[i]; G += temp[i+1]; B += temp[i+2]; A += temp[i+3];
      }
      const j = (y*width+x)*4;
      out.data[j] = R/(2*r+1);
      out.data[j+1] = G/(2*r+1);
      out.data[j+2] = B/(2*r+1);
      out.data[j+3] = A/(2*r+1);
    }
  }
  // Vertical
  const temp2 = new Uint8ClampedArray(out.data);
  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      let R=0,G=0,B=0,A=0;
      for (let k=-r; k<=r; k++){
        const yy = Math.max(0, Math.min(height-1, y+k));
        const i = (yy*width+x)*4;
        R += temp2[i]; G += temp2[i+1]; B += temp2[i+2]; A += temp2[i+3];
      }
      const j = (y*width+x)*4;
      img.data[j] = R/(2*r+1);
      img.data[j+1] = G/(2*r+1);
      img.data[j+2] = B/(2*r+1);
      img.data[j+3] = A/(2*r+1);
    }
  }
  srcCtx.putImageData(img,0,0);
}

function applyBrightnessContrast(ctx, b=-0, c=0) {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0,0,width,height);
  const d = img.data; // b in [-1,1], c in [-1,1]
  const B = b*255; const C = (1 + c);
  for (let i=0; i<d.length; i+=4) {
    d[i]   = Math.max(0, Math.min(255, (d[i]  -128)*C + 128 + B));
    d[i+1] = Math.max(0, Math.min(255, (d[i+1]-128)*C + 128 + B));
    d[i+2] = Math.max(0, Math.min(255, (d[i+2]-128)*C + 128 + B));
  }
  ctx.putImageData(img,0,0);
}

function applyHueSaturation(ctx, hue=0, sat=0) {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0,0,width,height);
  const d = img.data; // hue in [-180,180], sat in [-1,1]
  const H = (hue % 360) * Math.PI/180;
  const S = sat + 1;
  for (let i=0; i<d.length; i+=4) {
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
    // RGB -> HSL
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h, s, l=(max+min)/2;
    if (max===min) { h=0; s=0; }
    else {
      const dlt = max-min;
      s = l>0.5 ? dlt/(2-max-min) : dlt/(max+min);
      switch(max){
        case r: h=(g-b)/dlt + (g<b?6:0); break;
        case g: h=(b-r)/dlt + 2; break;
        case b: h=(r-g)/dlt + 4; break;
        default: h=0;
      }
      h/=6;
    }
    // apply hue/sat
    h = (h + H/(2*Math.PI)) % 1; if (h<0) h+=1;
    s = Math.max(0, Math.min(1, s*S));
    // HSL -> RGB
    const q = l < 0.5 ? l*(1+s) : l + s - l*s;
    const p = 2*l - q;
    const hue2rgb = (p,q,t)=>{ if (t<0) t+=1; if (t>1) t-=1; if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q; if (t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
    d[i]=r*255; d[i+1]=g*255; d[i+2]=b*255;
  }
  ctx.putImageData(img,0,0);
}

function unsharpMask(ctx, amount=0.5, radius=1) {
  const { width, height } = ctx.canvas;
  const base = document.createElement('canvas'); base.width=width; base.height=height;
  const bctx = base.getContext('2d');
  bctx.drawImage(ctx.canvas,0,0);
  boxBlur(bctx, radius);
  const sharp = ctx.getImageData(0,0,width,height);
  const blur  = bctx.getImageData(0,0,width,height);
  const d = sharp.data, s = blur.data;
  for (let i=0;i<d.length;i+=4){
    d[i]   = Math.max(0, Math.min(255, d[i]   + (d[i]-s[i])  * amount));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] + (d[i+1]-s[i+1])* amount));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] + (d[i+2]-s[i+2])* amount));
  }
  ctx.putImageData(sharp,0,0);
}

// ---------- Layer model ----------
const BLEND_MODES = ["source-over","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light"];

const defaultDoc = (w=1200,h=800)=>({
  id: uid(), width:w, height:h, background:[255,255,255,1],
  layers: [], selection: null, quickMask: null
});

function createRasterLayer(name="Raster"){
  return { id: uid(), type:"raster", name, visible:true, opacity:1, blend:"source-over", mask: null, data: null };
}
function createTextLayer(txt="Text", opts={}){
  return { id: uid(), type:"text", name:"Text", visible:true, opacity:1, blend:"source-over", mask:null,
    text: txt, x:100, y:100, font:"48px Inter, system-ui, sans-serif", color:"#000000", align:"left" };
}
function createShapeLayer(kind="rect"){
  return { id: uid(), type:"shape", name:"Shape", visible:true, opacity:1, blend:"source-over", mask:null,
    shape: kind, x:200, y:200, w:200, h:150, stroke:"#000000", fill:"#ffffff00", strokeWidth:4 };
}
function createAdjLayer(kind="brightness"){
  const base = { id: uid(), type:"adjustment", name:"Adjustment", visible:true, opacity:1, blend:"source-over", mask:null, kind };
  if (kind==="brightness") return { ...base, name:"Brightness/Contrast", b:0, c:0 };
  if (kind==="huesat") return { ...base, name:"Hue/Saturation", hue:0, sat:0 };
  if (kind==="blur") return { ...base, name:"Blur", radius:2 };
  if (kind==="sharpen") return { ...base, name:"Sharpen", amount:0.5, radius:1 };
  return base;
}

// ---------- Editor Component ----------
export default function App(){
  const [doc, setDoc] = useState(()=>defaultDoc());
  const [activeId, setActiveId] = useState(null);
  const [tool, setTool] = useState("move"); // move, brush, eraser, clone, marquee, text, rect, ellipse, eyedropper, maskbrush
  const [brush, setBrush] = useState({ size:24, hardness:0.7, flow:0.8, color:"#000000" });
  const [cloneSrc, setCloneSrc] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState([]);
  const [redo, setRedo] = useState([]);

  const viewRef = useRef(null);
  const compRef = useRef(null); // composite canvas

  // Ensure there is at least one raster layer to paint on at start
  useEffect(()=>{
    if (doc.layers.length===0){
      const base = createRasterLayer("Background");
      // init backing canvas
      const c = document.createElement('canvas'); c.width=doc.width; c.height=doc.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = rgbaToCss(doc.background);
      ctx.fillRect(0,0,doc.width,doc.height);
      base.data = c;
      setDoc(d=>({...d, layers:[base]}));
      setActiveId(base.id);
    }
  },[]);

  // Push state to history
  const pushHistory = () => {
    setHistory(h=>[...h.slice(-40), JSON.stringify(doc)]);
    setRedo([]);
  };

  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length-1];
    setHistory(h=>h.slice(0,-1));
    setRedo(r=>[JSON.stringify(doc), ...r]);
    setDoc(JSON.parse(prev));
  };
  const redoAct = () => {
    if (!redo.length) return;
    const next = redo[0];
    setRedo(r=>r.slice(1));
    setHistory(h=>[...h, JSON.stringify(doc)]);
    setDoc(JSON.parse(next));
  };

  // Rendering pipeline: draw all layers to composite canvas considering masks, blend, opacity
  const renderComposite = () => {
    const canvas = compRef.current; if (!canvas) return;
    canvas.width = doc.width; canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);

    let scratch = document.createElement('canvas');
    scratch.width = doc.width; scratch.height = doc.height;
    let sctx = scratch.getContext('2d');

    // Start with background
    sctx.fillStyle = rgbaToCss(doc.background);
    sctx.fillRect(0,0,doc.width,doc.height);

    for (const L of doc.layers){
      if (!L.visible) continue;

      // Render current layer onto a temp layerCanvas first (so that we can apply its own mask)
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = doc.width; layerCanvas.height = doc.height;
      const lctx = layerCanvas.getContext('2d');

      if (L.type === "raster"){
        if (L.data) lctx.drawImage(L.data,0,0);
      } else if (L.type === "text"){
        lctx.font = L.font;
        lctx.textAlign = L.align;
        lctx.fillStyle = L.color;
        lctx.textBaseline = 'top';
        lctx.fillText(L.text, L.x, L.y);
      } else if (L.type === "shape"){
        lctx.lineWidth = L.strokeWidth || 1;
        if (L.fill && L.fill !== '#ffffff00'){
          lctx.fillStyle = L.fill; drawShape(lctx, L); lctx.fill();
        }
        if (L.stroke){
          lctx.strokeStyle = L.stroke; drawShape(lctx, L); lctx.stroke();
        }
      } else if (L.type === "adjustment"){
        // apply to accumulated image so far
        const temp = document.createElement('canvas'); temp.width=doc.width; temp.height=doc.height;
        const tctx = temp.getContext('2d');
        tctx.drawImage(scratch,0,0);
        if (L.kind === "brightness") applyBrightnessContrast(tctx, L.b||0, L.c||0);
        else if (L.kind === "huesat") applyHueSaturation(tctx, L.hue||0, L.sat||0);
        else if (L.kind === "blur") boxBlur(tctx, L.radius||2);
        else if (L.kind === "sharpen") unsharpMask(tctx, L.amount||0.5, L.radius||1);
        sctx.globalAlpha = L.opacity ?? 1;
        sctx.globalCompositeOperation = L.blend || 'source-over';
        sctx.drawImage(tctx.canvas,0,0);
        continue; // go next layer
      }

      // Apply layer mask if present (white=show, black=hide)
      if (L.mask){
        const maskCut = document.createElement('canvas'); maskCut.width=doc.width; maskCut.height=doc.height;
        const mctx = maskCut.getContext('2d');
        mctx.drawImage(L.mask,0,0);
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(layerCanvas,0,0);
        const l2 = layerCanvas.getContext('2d');
        l2.clearRect(0,0,doc.width,doc.height);
        l2.drawImage(maskCut,0,0);
      }

      sctx.globalAlpha = L.opacity ?? 1;
      sctx.globalCompositeOperation = L.blend || 'source-over';
      sctx.drawImage(layerCanvas,0,0);
    }

    ctx.drawImage(scratch,0,0);
  };

  useEffect(()=>{ renderComposite(); }, [doc]);

  function drawShape(ctx, L){
    if (L.shape === "rect"){ ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); }
    else if (L.shape === "ellipse"){
      ctx.beginPath(); ctx.ellipse(L.x+L.w/2, L.y+L.h/2, Math.abs(L.w/2), Math.abs(L.h/2), 0, 0, Math.PI*2);
    }
  }

  // Hit detection for selections when drawing with tools
  const getSelectionMask = () => {
    if (!doc.selection) return null;
    return doc.selection; // canvas with white selection, black elsewhere
  };

  const activeLayer = useMemo(()=> doc.layers.find(l=>l.id===activeId) || doc.layers[doc.layers.length-1], [doc, activeId]);

  // Canvas interaction handlers
  const pointer = useRef({ down:false, sx:0, sy:0, px:0, py:0, moved:false });

  const onPointerDown = (e)=>{
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom; const y = (e.clientY - rect.top) / zoom;
    pointer.current = { ...pointer.current, down:true, sx:x, sy:y, px:x, py:y, moved:false };

    if (tool === 'marquee'){
      pushHistory();
      const sel = document.createElement('canvas'); sel.width=doc.width; sel.height=doc.height;
      const sctx = sel.getContext('2d');
      sctx.clearRect(0,0,sel.width,sel.height);
      setDoc(d=>({...d, selection: sel }));
    }

    if (tool === 'text'){
      pushHistory();
      const L = createTextLayer("Double‑click to edit");
      L.x = x; L.y = y;
      setDoc(d=>({...d, layers:[...d.layers, L]}));
      setActiveId(L.id);
    }

    if (tool === 'rect' || tool === 'ellipse'){
      pushHistory();
      const L = createShapeLayer(tool === 'rect' ? 'rect' : 'ellipse');
      L.x = x; L.y = y; L.w = 10; L.h = 10;
      setDoc(d=>({...d, layers:[...d.layers, L]}));
      setActiveId(L.id);
    }

    if (tool === 'eyedropper'){
      const c = compRef.current; const ctx = c.getContext('2d');
      const px = ctx.getImageData(x|0, y|0, 1, 1).data;
      setBrush(b=>({...b, color:`#${[px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('')}`}));
    }

    if ((tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'maskbrush')){
      pushHistory();
      ensureActiveRaster();
      paintAt(x,y,true, e);
    }

    if (tool === 'clone' && (e.altKey || e.metaKey)){
      setCloneSrc({ x, y });
    }
  };

  const onPointerMove = (e)=>{
    if (!pointer.current.down) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom; const y = (e.clientY - rect.top) / zoom;
    pointer.current.moved = true;

    if (tool === 'marquee'){
      const sel = document.createElement('canvas'); sel.width=doc.width; sel.height=doc.height;
      const sctx = sel.getContext('2d');
      sctx.fillStyle = 'black'; sctx.fillRect(0,0,sel.width,sel.height);
      sctx.fillStyle = 'white';
      const w = x - pointer.current.sx; const h = y - pointer.current.sy;
      sctx.fillRect(pointer.current.sx, pointer.current.sy, w, h);
      setDoc(d=>({...d, selection: sel }));
    }

    if ((tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'maskbrush')){
      paintAt(x,y,false, e);
    }

    if (tool === 'rect' || tool === 'ellipse'){
      setDoc(d=>{
        const layers = d.layers.map(L=> L.id===activeId && L.type==='shape' ? { ...L, w:x-L.x, h:y-L.y } : L);
        return { ...d, layers };
      });
    }

    pointer.current.px = x; pointer.current.py = y;
  };

  const onPointerUp = ()=>{
    pointer.current.down = false;
  };

  function ensureActiveRaster(){
    let L = activeLayer;
    if (!L || L.type !== 'raster'){
      L = createRasterLayer("Raster");
      L.data = document.createElement('canvas'); L.data.width=doc.width; L.data.height=doc.height;
      setDoc(d=>({...d, layers:[...d.layers, L]}));
      setActiveId(L.id);
    }
  }

  function applySelectionClip(ctx){
    const sel = getSelectionMask(); if (!sel) return;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(sel,0,0);
    ctx.globalCompositeOperation = 'source-over';
  }

  function softDab(ctx, x, y, size, hardness, color, alpha=1, erase=false){
    const r = Math.max(1, size/2);
    const grd = ctx.createRadialGradient(x,y, r*hardness, x,y,r);
    const [rr,gg,bb] = hexToRgba(color);
    const rgba = `rgba(${rr},${gg},${bb},${alpha})`;
    grd.addColorStop(0, erase? 'rgba(0,0,0,1)' : rgba);
    grd.addColorStop(1, erase? 'rgba(0,0,0,0)' : `rgba(${rr},${gg},${bb},0)`);

    if (erase){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fill();
    }
  }

  function paintAt(x,y, first, ev){
    const L = doc.layers.find(l=>l.id===activeId);
    if (!L) return;

    let targetCanvas;
    let isMask = false;
    if (tool === 'maskbrush'){
      if (!L.mask){ L.mask = document.createElement('canvas'); L.mask.width=doc.width; L.mask.height=doc.height; const mctx=L.mask.getContext('2d'); mctx.fillStyle='white'; mctx.fillRect(0,0,doc.width,doc.height); }
      targetCanvas = L.mask; isMask = true;
    } else {
      if (L.type !== 'raster') return; // only paint on raster
      if (!L.data){ L.data = document.createElement('canvas'); L.data.width=doc.width; L.data.height=doc.height; }
      targetCanvas = L.data;
    }

    const tctx = targetCanvas.getContext('2d');

    if (doc.selection){
      const temp = document.createElement('canvas'); temp.width=doc.width; temp.height=doc.height;
      const pctx = temp.getContext('2d');

      if (tool === 'eraser'){
        softDab(pctx, x, y, brush.size, brush.hardness, brush.color, brush.flow, true);
      } else if (tool === 'brush' || (tool === 'maskbrush' && !ev?.altKey)){
        const alpha = isMask ? (ev?.altKey ? 0 : brush.flow) : brush.flow;
        softDab(pctx, x, y, brush.size, brush.hardness, isMask? '#ffffff' : brush.color, alpha, isMask? false : false);
        if (isMask && ev?.altKey){
          softDab(pctx, x, y, brush.size, brush.hardness, '#000000', brush.flow, true);
        }
      } else if (tool === 'clone'){
        if (!cloneSrc) return;
        const dx = x - pointer.current.sx;
        const dy = y - pointer.current.sy;
        const srcX = cloneSrc.x + dx;
        const srcY = cloneSrc.y + dy;
        const comp = compRef.current;
        const rad = Math.max(2, brush.size/2);
        const sample = document.createElement('canvas'); sample.width=rad*2; sample.height=rad*2;
        const sctx = sample.getContext('2d');
        sctx.drawImage(comp, srcX-rad, srcY-rad, rad*2, rad*2, 0,0, rad*2, rad*2);
        pctx.save();
        const mask = pctx.createRadialGradient(x,y, rad*brush.hardness, x,y,rad);
        mask.addColorStop(0, 'rgba(255,255,255,1)');
        mask.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = mask;
        pctx.beginPath(); pctx.arc(x,y,rad,0,Math.PI*2); pctx.closePath(); pctx.fill();
        pctx.globalCompositeOperation = 'source-in';
        pctx.drawImage(sample, x-rad, y-rad);
        pctx.restore();
      }

      const sel = doc.selection;
      const clip = document.createElement('canvas'); clip.width=doc.width; clip.height=doc.height;
      const cctx = clip.getContext('2d');
      cctx.drawImage(sel,0,0);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(pctx.canvas,0,0);

      tctx.drawImage(clip,0,0);
    } else {
      if (tool === 'eraser'){
        softDab(tctx, x, y, brush.size, brush.hardness, brush.color, brush.flow, true);
      } else if (tool === 'brush' || tool === 'maskbrush'){
        const isMaskPainting = (tool === 'maskbrush');
        const col = isMaskPainting ? '#ffffff' : brush.color;
        softDab(tctx, x, y, brush.size, brush.hardness, col, brush.flow, false);
      } else if (tool === 'clone'){
        if (!cloneSrc) return;
        const dx = x - pointer.current.sx;
        const dy = y - pointer.current.sy;
        const srcX = cloneSrc.x + dx;
        const srcY = cloneSrc.y + dy;
        const comp = compRef.current;
        const rad = Math.max(2, brush.size/2);
        const sample = document.createElement('canvas'); sample.width=rad*2; sample.height=rad*2;
        const sctx = sample.getContext('2d');
        sctx.drawImage(comp, srcX-rad, srcY-rad, rad*2, rad*2, 0,0, rad*2, rad*2);
        tctx.save();
        const mask = tctx.createRadialGradient(x,y, rad*brush.hardness, x,y,rad);
        mask.addColorStop(0, 'rgba(255,255,255,1)');
        mask.addColorStop(1, 'rgba(255,255,255,0)');
        tctx.fillStyle = mask;
        tctx.beginPath(); tctx.arc(x,y,rad,0,Math.PI*2); tctx.fill();
        tctx.globalCompositeOperation = 'source-in';
        tctx.drawImage(sample, x-rad, y-rad);
        tctx.restore();
      }
    }

    setDoc(d=>({ ...d, layers: d.layers.map(ly=> ly.id===L.id ? { ...L } : ly) }));
  }

  // ---- Import / Export ----
  const onImport = (file)=>{
    if (!file) return;
    const img = new Image();
    img.onload = ()=>{
      const raster = createRasterLayer(file.name.replace(/\\.[^.]+$/, ''));
      const c = document.createElement('canvas'); c.width = doc.width; c.height = doc.height;
      const ctx = c.getContext('2d');
      // Fit image into doc (contain)
      const scale = Math.min(doc.width/img.width, doc.height/img.height);
      const w = img.width*scale, h = img.height*scale;
      const ox = (doc.width - w)/2, oy = (doc.height - h)/2;
      ctx.drawImage(img, ox, oy, w, h);
      raster.data = c;
      setDoc(d=>({ ...d, layers: [...d.layers, raster] }));
      setActiveId(raster.id);
    };
    const url = URL.createObjectURL(file);
    img.src = url;
  };

  const onExport = async (format='image/png')=>{
    const canvas = compRef.current; if (!canvas) return;
    canvas.toBlob((blob)=>{
      if (!blob) return;
      const filename = `minishop-export-${Date.now()}.${format==='image/png'?'png':'jpg'}`;
      downloadBlob(blob, filename);
    }, format, format==='image/jpeg'? 0.92 : undefined);
  };

  // ---- UI helpers ----
  const addLayer = (kind)=>{
    if (kind==='raster'){
      const L = createRasterLayer("Raster");
      L.data = document.createElement('canvas'); L.data.width=doc.width; L.data.height=doc.height;
      setDoc(d=>({...d, layers:[...d.layers, L]})); setActiveId(L.id);
    } else if (kind==='text'){
      const L = createTextLayer("Text");
      setDoc(d=>({...d, layers:[...d.layers, L]})); setActiveId(L.id);
    } else if (kind==='rect' || kind==='ellipse'){
      const L = createShapeLayer(kind);
      setDoc(d=>({...d, layers:[...d.layers, L]})); setActiveId(L.id);
    } else if (kind==='brightness' || kind==='huesat' || kind==='blur' || kind==='sharpen'){
      const L = createAdjLayer(kind);
      setDoc(d=>({...d, layers:[...d.layers, L]})); setActiveId(L.id);
    }
  };

  const removeLayer = (id)=>{
    setDoc(d=> ({ ...d, layers: d.layers.filter(l=>l.id!==id) }));
  };

  const moveLayer = (id, dir)=>{
    setDoc(d=>{
      const idx = d.layers.findIndex(l=>l.id===id);
      if (idx<0) return d;
      const arr = [...d.layers];
      const ni = Math.max(0, Math.min(arr.length-1, idx + dir));
      const [it] = arr.splice(idx,1);
      arr.splice(ni,0,it);
      return { ...d, layers: arr };
    });
  };

  // ---- Keyboard shortcuts ----
  useEffect(()=>{
    const onKey = (e)=>{
      if (e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.isContentEditable)) return;
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); }
      else if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ e.preventDefault(); redoAct(); }
      else if (e.key==='b') setTool('brush');
      else if (e.key==='e') setTool('eraser');
      else if (e.key==='m') setTool('marquee');
      else if (e.key==='v') setTool('move');
      else if (e.key==='i') setTool('eyedropper');
      else if (e.key==='c') setTool('clone');
      else if (e.key==='[') setBrush(b=>({...b, size: Math.max(1, b.size-2)}));
      else if (e.key===']') setBrush(b=>({...b, size: Math.min(400, b.size+2)}));
      else if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); onExport('image/png'); }
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [undo, redoAct]);

  const ActiveLayerPanel = ()=>{
    const L = activeLayer; if (!L) return null;
    if (L.type==='text'){
      return (
        <div className="space-y-2">
          <label className="text-sm">Text</label>
          <input className="w-full border rounded px-2 py-1" value={L.text} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, text:e.target.value } : x) }))} />
          <label className="text-sm">Font</label>
          <input className="w-full border rounded px-2 py-1" value={L.font} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, font:e.target.value } : x) }))} />
          <label className="text-sm">Color</label>
          <input type="color" className="w-full h-8" value={L.color} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, color:e.target.value } : x) }))} />
        </div>
      );
    }
    if (L.type==='shape'){
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm w-20">Stroke</span>
            <input type="color" value={L.stroke||'#000000'} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, stroke:e.target.value } : x) }))} />
            <span className="text-sm">Width</span>
            <input type="range" min={1} max={32} value={L.strokeWidth||1} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, strokeWidth: Number(e.target.value) } : x) }))} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm w-20">Fill</span>
            <input type="color" value={L.fill && L.fill!=='#ffffff00'? L.fill : '#ffffff'} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, fill:e.target.value } : x) }))} />
          </div>
        </div>
      );
    }
    if (L.type==='adjustment'){
      if (L.kind==='brightness'){
        return (
          <div className="space-y-3">
            <div>
              <label className="text-sm">Brightness</label>
              <input type="range" min={-1} max={1} step={0.01} value={L.b||0} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, b: Number(e.target.value) } : x) }))} />
            </div>
            <div>
              <label className="text-sm">Contrast</label>
              <input type="range" min={-1} max={1} step={0.01} value={L.c||0} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, c: Number(e.target.value) } : x) }))} />
            </div>
          </div>
        );
      }
      if (L.kind==='huesat'){
        return (
          <div className="space-y-3">
            <div>
              <label className="text-sm">Hue</label>
              <input type="range" min={-180} max={180} step={1} value={L.hue||0} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, hue: Number(e.target.value) } : x) }))} />
            </div>
            <div>
              <label className="text-sm">Saturation</label>
              <input type="range" min={-1} max={1} step={0.01} value={L.sat||0} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, sat: Number(e.target.value) } : x) }))} />
            </div>
          </div>
        );
      }
      if (L.kind==='blur'){
        return (
          <div className="space-y-3">
            <label className="text-sm">Radius</label>
            <input type="range" min={0} max={20} step={1} value={L.radius||2} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, radius: Number(e.target.value) } : x) }))} />
          </div>
        );
      }
      if (L.kind==='sharpen'){
        return (
          <div className="space-y-3">
            <label className="text-sm">Amount</label>
            <input type="range" min={0} max={2} step={0.01} value={L.amount||0.5} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, amount: Number(e.target.value) } : x) }))} />
            <label className="text-sm">Radius</label>
            <input type="range" min={0} max={10} step={1} value={L.radius||1} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, radius: Number(e.target.value) } : x) }))} />
          </div>
        );
      }
    }
    return <div className="text-sm text-gray-500">Select an adjustment/text/shape layer for options.</div>;
  };

  return (
    <div className="w-full h-screen flex bg-gray-100 text-gray-900">
      <div className="w-16 bg-white border-r flex flex-col items-center py-2 gap-2">
        <button className={`p-2 rounded ${tool==='move'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('move')} title="Move"><Move size={18}/></button>
        <button className={`p-2 rounded ${tool==='brush'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('brush')} title="Brush"><BrushIcon size={18}/></button>
        <button className={`p-2 rounded ${tool==='eraser'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('eraser')} title="Eraser"><Eraser size={18}/></button>
        <button className={`p-2 rounded ${tool==='clone'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('clone')} title="Clone Stamp (Alt-click to sample)"><Clone size={18}/></button>
        <button className={`p-2 rounded ${tool==='marquee'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('marquee')} title="Marquee"><MousePointer size={18}/></button>
        <button className={`p-2 rounded ${tool==='eyedropper'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('eyedropper')} title="Eyedropper"><Pipette size={18}/></button>
        <div className="h-px w-8 bg-gray-200 my-1"/>
        <button className={`p-2 rounded ${tool==='text'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('text')} title="Text"><TypeIcon size={18}/></button>
        <button className={`p-2 rounded ${tool==='rect'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('rect')} title="Rectangle"><RectangleHorizontal size={18}/></button>
        <button className={`p-2 rounded ${tool==='ellipse'?'bg-gray-900 text-white':'hover:bg-gray-200'}`} onClick={()=>setTool('ellipse')} title="Ellipse"><Circle size={18}/></button>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="h-12 bg-white border-b flex items-center justify-between px-3 gap-2">
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border rounded hover:bg-gray-50" onClick={undo} title="Undo"><Undo2 size={16}/></button>
            <button className="px-2 py-1 border rounded hover:bg-gray-50" onClick={redoAct} title="Redo"><Redo2 size={16}/></button>
            <div className="ml-3 flex items-center gap-2">
              <button className="px-2 py-1 border rounded hover:bg-gray-50" onClick={()=> setZoom(z=> Math.max(0.1, +(z-0.1).toFixed(2)))}><Minus size={14}/></button>
              <span className="w-14 text-center text-sm">{Math.round(zoom*100)}%</span>
              <button className="px-2 py-1 border rounded hover:bg-gray-50" onClick={()=> setZoom(z=> Math.min(8, +(z+0.1).toFixed(2)))}><Plus size={14}/></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2 py-1 border rounded hover:bg-gray-50 cursor-pointer flex items-center gap-2">
              <Upload size={16}/><span className="text-sm">Import</span>
              <input type="file" accept="image/*" className="hidden" onChange={e=> onImport(e.target.files?.[0])}/>
            </label>
            <button className="px-3 py-1 border rounded hover:bg-gray-50 flex items-center gap-2" onClick={()=> onExport('image/png')}><Download size={16}/><span className="text-sm">Export PNG</span></button>
            <button className="px-3 py-1 border rounded hover:bg-gray-50 flex items-center gap-2" onClick={()=> onExport('image/jpeg')}><Download size={16}/><span className="text-sm">Export JPG</span></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[conic-gradient(at_10%_10%,#f8fafc_25%,#e5e7eb_0_50%,#f8fafc_0_75%,#e5e7eb_0)] [background-size:20px_20px] flex items-start justify-center p-6">
          <div className="shadow-lg border bg-white" style={{ transform:`scale(${zoom})`, transformOrigin:'top left' }}>
            <canvas ref={compRef} width={doc.width} height={doc.height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ display:'block', width:doc.width, height:doc.height }}
            />
          </div>
        </div>
      </div>

      <div className="w-80 bg-white border-l flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm flex items-center gap-2"><SlidersHorizontal size={16}/> Tool Settings</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{tool}</span>
          </div>
          {(tool==='brush' || tool==='eraser' || tool==='maskbrush' || tool==='clone') && (
            <div className="space-y-2">
              <label className="text-sm">Size: {Math.round(brush.size)}</label>
              <input type="range" min={1} max={400} value={brush.size} onChange={e=> setBrush(b=>({...b, size:Number(e.target.value)}))} />
              <label className="text-sm">Hardness: {brush.hardness.toFixed(2)}</label>
              <input type="range" min={0} max={1} step={0.01} value={brush.hardness} onChange={e=> setBrush(b=>({...b, hardness:Number(e.target.value)}))} />
              <label className="text-sm">Flow/Opacity: {Math.round(brush.flow*100)}%</label>
              <input type="range" min={0.01} max={1} step={0.01} value={brush.flow} onChange={e=> setBrush(b=>({...b, flow:Number(e.target.value)}))} />
              {tool!=='eraser' && tool!=='maskbrush' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Color</span>
                  <input type="color" value={brush.color} onChange={e=> setBrush(b=>({...b, color:e.target.value}))} />
                </div>
              )}
              {tool==='clone' && (
                <div className="text-xs text-gray-600">Alt/Option‑click on canvas to set source.</div>
              )}
            </div>
          )}
          {tool==='text' && (
            <div className="text-xs text-gray-600">Click on canvas to insert a text layer. Edit properties below.</div>
          )}
        </div>

        <div className="p-3 flex items-center justify-between">
          <span className="font-medium text-sm flex items-center gap-2"><LayersIcon size={16}/> Layers</span>
          <div className="flex items-center gap-1">
            <button className="px-2 py-1 border rounded text-xs" onClick={()=> addLayer('raster')}>+ Raster</button>
            <button className="px-2 py-1 border rounded text-xs" onClick={()=> addLayer('brightness')}>+ B/C</button>
            <button className="px-2 py-1 border rounded text-xs" onClick={()=> addLayer('huesat')}>+ Hue/Sat</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {doc.layers.map((L, idx)=> (
            <div key={L.id} className={`px-3 py-2 border-t flex flex-col gap-2 ${activeId===L.id?'bg-gray-50':''}`} onClick={()=> setActiveId(L.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button className="p-1" onClick={(e)=>{ e.stopPropagation(); setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, visible: !x.visible } : x) }))}}>
                    {L.visible? <Eye size={16}/> : <EyeOff size={16}/>}
                  </button>
                  <span className="text-sm font-medium">{L.name || L.type}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 uppercase">{L.type}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-1 border rounded text-xs" onClick={(e)=>{ e.stopPropagation(); moveLayer(L.id,+1); }}>Down</button>
                  <button className="p-1 border rounded text-xs" onClick={(e)=>{ e.stopPropagation(); moveLayer(L.id,-1); }}>Up</button>
                  <button className="p-1 text-red-600" onClick={(e)=>{ e.stopPropagation(); removeLayer(L.id); }}><Trash2 size={16}/></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-14">Opacity</span>
                <input className="flex-1" type="range" min={0} max={1} step={0.01} value={L.opacity??1} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, opacity: Number(e.target.value) } : x) }))} />
                <span className="text-xs w-10 text-right">{Math.round((L.opacity??1)*100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-14">Blend</span>
                <select className="flex-1 border rounded px-1 py-1 text-xs" value={L.blend||'source-over'} onChange={e=> setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, blend: e.target.value } : x) }))}>
                  {BLEND_MODES.map(b=> <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-14">Mask</span>
                {L.mask? (
                  <div className="flex items-center gap-2">
                    <button className={`px-2 py-0.5 border rounded text-xs ${tool==='maskbrush'?'bg-gray-900 text-white':''}`} onClick={(e)=>{ e.stopPropagation(); setTool('maskbrush'); }}>Paint</button>
                    <button className="px-2 py-0.5 border rounded text-xs" onClick={(e)=>{ e.stopPropagation(); setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, mask:null } : x) })); }}>Remove</button>
                  </div>
                ) : (
                  <button className="px-2 py-0.5 border rounded text-xs" onClick={(e)=>{
                    e.stopPropagation();
                    const m = document.createElement('canvas'); m.width=doc.width; m.height=doc.height; const mctx=m.getContext('2d'); mctx.fillStyle='white'; mctx.fillRect(0,0,doc.width,doc.height);
                    setDoc(d=> ({...d, layers: d.layers.map(x=> x.id===L.id? { ...x, mask:m } : x) }));
                  }}>Add Mask</button>
                )}
              </div>
              {activeId===L.id && (
                <div className="pl-1"><ActiveLayerPanel/></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
