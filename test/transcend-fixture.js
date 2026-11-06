// Copies the africatechfestival.com setup (Transcend + AdRoll), found on 6 Nov 2026:
//  - the main consent banner lives in a CLOSED shadow root, in French ("Tout accepter" / "Tout rejeter")
//  - before any choice, only Meta's script file is downloaded (no events, no cookies)
//  - after rejecting, a second banner from the ad vendor appears ("DECLINE ALL" / "ALLOW ALL" as <a href="javascript:void(0)">)
//  - if the visitor declines both, nothing tracks; withdrawal goes through window.transcend.showConsentManager()
// Expected: banner found, both banners rejected, only a moderate "scripts before consent" finding.
import http from 'node:http';

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Festival</title></head><body>
<div id="tc-host"></div>
<header><nav><a href="/a">Programme</a> <a href="/b">Billets</a></nav></header>
<main><h1>Festival</h1><p>Bienvenue.</p></main>
<div id="adroll_consent_banner" style="display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;padding:12px">
  <p>We Value Your Privacy</p>
  <a id="adroll_consent_reject" href="javascript:void(0)" onclick="adroll('declined')">DECLINE ALL</a>
  <a id="adroll_consent_accept" href="javascript:void(0)" onclick="adroll('allowed')">ALLOW ALL</a>
</div>
<script>
  function c(n){ var m=document.cookie.match(new RegExp(n+'=(\\\\w+)')); return m?m[1]:null; }
  // Script-only preload (no events): Meta's library file.
  var s=document.createElement('script'); s.src='https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(s);
  function fire(){
    if (c('tc')==='accepted') { (new Image()).src='https://www.google-analytics.com/g/collect?v=2&en=page_view'; document.cookie='_ga=GA1.1.1.1; path=/; max-age=9999999'; }
    if (c('tc') && c('ar')!=='declined') { (new Image()).src='https://d.adroll.com/cm/r/out?ev=pageview'; }
  }
  function adroll(v){ document.cookie='ar='+v+'; path=/; max-age=9999999'; document.getElementById('adroll_consent_banner').style.display='none'; }
  var host=document.getElementById('tc-host');
  var root=host.attachShadow({mode:'closed'});
  root.innerHTML='<div role="dialog" aria-label="Choix en matière de confidentialité" style="position:fixed;top:10%;left:10%;right:10%;background:#fff;border:1px solid #333;padding:20px">'+
    '<h2>Choix en matière de confidentialité</h2><p>Nos partenaires et nous-mêmes utilisons des cookies.</p>'+
    '<button id="acc">Tout accepter</button> <button id="rej">Tout rejeter</button> <button>Gérer les préférences</button></div>';
  function show(v){ root.firstChild.style.display=v?'block':'none'; }
  function choose(v){ document.cookie='tc='+v+'; path=/; max-age=9999999'; show(false);
    if (!c('ar')) document.getElementById('adroll_consent_banner').style.display='block';
    fire(); }
  root.getElementById('acc').onclick=function(){ choose('accepted'); };
  root.getElementById('rej').onclick=function(){ choose('rejected'); };
  window.transcend={ showConsentManager:function(){ show(true); } };
  show(!c('tc'));
  if (c('tc') && !c('ar')) document.getElementById('adroll_consent_banner').style.display='block';
  fire();
</script></body></html>`;

export function startTranscendFixture(port = 8101) {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }).listen(port);
  return () => srv.close();
}
