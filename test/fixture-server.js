// Two local test sites:
//   BAD  (port A): tracks before consent, ignores Reject, withdrawal and GPC, has accessibility errors,
//                  an undisclosed chatbot and an unlabelled AI image.
//   GOOD (port B): the same site done right. Should produce no consent/GPC/AI findings.
// Tracker URLs point at real tracker hosts; the requests fail offline, but they are still "sent",
// which is exactly what the worker records.
import http from 'node:http';
import zlib from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, xmp) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3, 120); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (xmp) parts.push(chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0' + xmp)));
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const AI_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></rdf:RDF></x:xmpmeta>';

function page(mode, path) {
  const bad = mode === 'bad';
  const navLinks = Array.from({ length: 30 }, (_, i) => `<a href="/p${i % 3}">Link ${i + 1}</a>`).join(' ');
  const trackers = {
    ga: `(new Image()).src='https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view'; document.cookie='_ga=GA1.1.123456789.1730000000; path=/; max-age=34560000';`,
    meta: `var s=document.createElement('script'); s.src='https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(s); document.cookie='_fbp=fb.1.1730000000.42; path=/; max-age=7776000';`,
    ads: `(new Image()).src='https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/?gpc_test=1';`,
    tiktok: `(new Image()).src='https://analytics.tiktok.com/api/v2/pixel?sdkid=TEST';`,
  };
  const script = `
  <script>
    function consent(){ var m=document.cookie.match(/consent=(\\w+)/); return m?m[1]:null; }
    var gpc = navigator.globalPrivacyControl === true;
    ${bad ? `
      // BAD: analytics before any choice, storage identifier, Meta after reject, ads ignore GPC
      ${trackers.ga}
      try { localStorage.setItem('_hjSessionUser_123', 'eyJpZCI6ImFiYyJ9'); } catch(e){}
      if (consent()==='rejected') { ${trackers.meta} }
      if (consent()==='accepted') { ${trackers.meta} ${trackers.tiktok} }
      ${trackers.ads}
    ` : `
      // GOOD: nothing until accepted; never ads when GPC is on
      if (consent()==='accepted') { ${trackers.ga} if(!gpc){ ${trackers.meta} ${trackers.ads} } }
    `}
    function choose(v){ document.cookie='consent='+v+'; path=/; max-age=15552000'; document.getElementById('cb').style.display='none';
      if(v==='accepted'){ ${bad ? trackers.meta + trackers.tiktok : trackers.ga + 'if(!gpc){' + trackers.meta + '}'} } }
    function openSettings(){ document.getElementById('cb').style.display='block'; ${bad ? '' : "document.getElementById('cb-reject').focus();"} }
    // Chat widget mimicking a vendor API (window.Intercom)
    window.Intercom = function(cmd){ if(cmd!=='show') return;
      var d=document.getElementById('chat'); d.style.display='block';
      d.querySelector('.msgs').innerText = ${bad ? '"Hi! I\'m Sophie, how can I help you today?"' : '"Hi, I\'m Sophie, an AI assistant. I can make mistakes. Ask for a person at any time."'};
    };
    function chatKey(e){ if(e.key==='Enter'){ e.preventDefault(); var box=e.target; var d=document.querySelector('#chat .msgs');
      d.innerText += '\\nYou: '+box.value; box.value='';
      setTimeout(function(){ d.innerText += '\\nSophie: Sure, please share your order number and I will look it up.'; }, 800); } }
  </script>`;
  const banner = `
  <div id="cb" ${bad ? '' : 'role="region" aria-label="Cookies"'} style="position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ccc;padding:16px;display:${'${show}'}">
    <p>Nous utilisons des cookies.</p>
    <button id="cb-accept" onclick="choose('accepted')">Tout accepter</button>
    <button id="cb-reject" onclick="choose('rejected')">Tout refuser</button>
  </div>`;
  const a11y = bad
    ? `<img src="/hero.png" width="300" height="200"><p style="color:#aaa;background:#fff">Low contrast text</p><a href="/p1"><svg width="10" height="10"></svg></a>`
    : `<figure><img src="/hero.png" width="300" height="200" alt="Summer collection"><figcaption>AI-generated image</figcaption></figure><p style="color:#333">Readable text</p><a href="/p1">Summer sale</a>`;
  const chat = `<div id="chat" role="dialog" aria-label="Chat" style="display:none;position:fixed;right:10px;bottom:80px;width:280px;background:#fff;border:1px solid #ccc;padding:8px"><div class="msgs"></div><textarea aria-label="Message" onkeydown="chatKey(event)"></textarea></div>`;
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Shop ${mode} ${path}</title>${bad ? '' : ''}</head><body>
  ${bad ? `<header><nav>${navLinks}</nav></header>` : `${banner}<header><nav><a href="/p0">Home</a> <a href="/p1">Sale</a> <a href="/p2">Help</a></nav></header>`}
  <main><h1>Shop</h1>${a11y}</main>
  <footer><a href="#" onclick="openSettings();return false;">Paramètres des cookies</a></footer>
  ${bad ? banner : ''}
  ${chat}
  ${script}
  <script>document.getElementById('cb').style.display = consent() ? 'none' : 'block';</script>
  </body></html>`;
  return body.replace('${show}', 'block');
}

export function startFixtures(badPort = 8099, goodPort = 8100) {
  const make = (mode) =>
    http.createServer((req, res) => {
      if (req.url.startsWith('/hero.png')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(png(300, 200, AI_XMP));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(mode, req.url));
    });
  const a = make('bad').listen(badPort);
  const b = make('good').listen(goodPort);
  return () => { a.close(); b.close(); };
}

if (process.argv[1] && process.argv[1].endsWith('fixture-server.js')) {
  startFixtures();
  console.log('fixtures on http://localhost:8099 (bad) and http://localhost:8100 (good)');
}
