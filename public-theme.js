"use strict";
(function(){
  const APPEARANCE_KEY="vune_appearance_pref_v1";
  const ACCENT_KEY="vune_accent_pref_v1";
  const accents=["lavender","blue","mint","pink","peach","periwinkle","aqua","sage","butter","mauve"];
  const colors={lavender:"#9b7fbd",blue:"#8fb7d7",mint:"#9ccdb8",pink:"#d7a7bf",peach:"#e7b496",periwinkle:"#aeb8e8",aqua:"#9fd7d8",sage:"#b9cfae",butter:"#e9d890",mauve:"#c7a9c8"};
  function apply(){
    const appearance=["light","dark","system"].includes(localStorage.getItem(APPEARANCE_KEY))?localStorage.getItem(APPEARANCE_KEY):"light";
    const accent=accents.includes(localStorage.getItem(ACCENT_KEY))?localStorage.getItem(ACCENT_KEY):"lavender";
    const dark=appearance==="dark"||(appearance==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.classList.toggle("theme-dark",dark);
    accents.forEach(name=>document.body.classList.toggle("accent-"+name,name===accent));
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content",dark?"#17151b":colors[accent]);
    if(window.self!==window.top){
      document.documentElement.classList.add("vune-framed");
      try{window.top.location=window.self.location.href;}catch(error){}
    }
  }
  apply();
  if(window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",apply);
})();