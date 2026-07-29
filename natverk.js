/* ====================================================================
   natverk.js — Explorations: fulltextsokning och slaktskapsnatverk
   ====================================================================
   Inga beroenden. Laddas med <script defer src="natverk.js"></script>.

   Tva datafiler, byggda av .agent/scripts/build_search_index.py:

     natverk-index.json  liten, hamtas direkt, driver natverket
     sok-index.json      stor, hamtas lat vid forsta sokinteraktionen

   Om nagon av filerna inte gar att hamta faller sidan tillbaka pa
   kortrutnatet och en enkel sokning i korten. Sidan ska aldrig bli
   oanvandbar for att en JSON-fil fattas.
   ==================================================================== */

(function () {
  'use strict';

  // ── Konfiguration ────────────────────────────────────────────────

  var POANG = {
    titel: 12,   // sokordet finns i artikelns rubrik
    amne: 8,     // ... i amnesetiketten
    rubrik: 6,   // ... i ett avsnitts rubrik
    text: 1,     // ... i brodtexten, per forekomst
    fras: 8      // hela sokstrangen forekommer ordagrant
  };
  var TAK_PER_TERM = 5;      // en term far ge hogst sa manga textpoang per avsnitt
  var MIN_TECKEN = 2;        // sokning startar vid sa manga tecken
  var FORDROJNING = 120;     // ms innan sokningen kors efter tangenttryck
  var MAX_AVSNITT = 4;       // sa manga avsnittstraffar visas per artikel i listan
  var KONTEXT = 70;          // tecken pa var sida om traffen i utdraget

  // ── Sma hjalpare ─────────────────────────────────────────────────

  function bokstav(tecken) {
    return /[^\W\d_]/.test(tecken);
  }

  function dela(strang) {
    var ut = [];
    var aktuellt = '';
    for (var i = 0; i < strang.length; i++) {
      if (bokstav(strang[i])) {
        aktuellt += strang[i];
      } else if (aktuellt) {
        ut.push(aktuellt.toLowerCase());
        aktuellt = '';
      }
    }
    if (aktuellt) ut.push(aktuellt.toLowerCase());
    return ut;
  }

  /* Raknar hur manga ganger term inleder ett ord i text.
     Manuell scanning i stallet for regex, sa att inga
     lookbehind-beroenden smyger in och bryter i aldre Safari. */
  function raknaTraffar(text, term, tak) {
    if (!term) return 0;
    var lag = text.toLowerCase();
    var antal = 0;
    var pos = lag.indexOf(term);
    while (pos !== -1) {
      if (pos === 0 || !bokstav(lag[pos - 1])) {
        antal++;
        if (tak && antal >= tak) return antal;
      }
      pos = lag.indexOf(term, pos + 1);
    }
    return antal;
  }

  function forstaTraff(text, term) {
    var lag = text.toLowerCase();
    var pos = lag.indexOf(term);
    while (pos !== -1) {
      if (pos === 0 || !bokstav(lag[pos - 1])) return pos;
      pos = lag.indexOf(term, pos + 1);
    }
    return -1;
  }

  function fly(strang) {
    return String(strang)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Bygger ett utdrag runt forsta traffen och markerar alla termer. */
  function utdrag(text, termer) {
    var basta = -1;
    for (var i = 0; i < termer.length; i++) {
      var p = forstaTraff(text, termer[i]);
      if (p !== -1 && (basta === -1 || p < basta)) basta = p;
    }
    if (basta === -1) basta = 0;

    var start = Math.max(0, basta - KONTEXT);
    var slut = Math.min(text.length, basta + KONTEXT * 2);
    while (start > 0 && bokstav(text[start - 1])) start--;
    while (slut < text.length && bokstav(text[slut])) slut++;

    var bit = text.slice(start, slut);
    var lag = bit.toLowerCase();

    // Samla alla intervall som ska markeras, sla ihop overlapp.
    var intervall = [];
    for (var j = 0; j < termer.length; j++) {
      var term = termer[j];
      var pos = lag.indexOf(term);
      while (pos !== -1) {
        if (pos === 0 || !bokstav(lag[pos - 1])) {
          var stopp = pos + term.length;
          while (stopp < bit.length && bokstav(bit[stopp])) stopp++;
          intervall.push([pos, stopp]);
        }
        pos = lag.indexOf(term, pos + 1);
      }
    }
    intervall.sort(function (a, b) { return a[0] - b[0]; });

    var ut = '';
    var kant = 0;
    for (var k = 0; k < intervall.length; k++) {
      if (intervall[k][0] < kant) continue;
      ut += fly(bit.slice(kant, intervall[k][0]));
      ut += '<mark>' + fly(bit.slice(intervall[k][0], intervall[k][1])) + '</mark>';
      kant = intervall[k][1];
    }
    ut += fly(bit.slice(kant));

    return (start > 0 ? '… ' : '') + ut + (slut < text.length ? ' …' : '');
  }

  // ── Sokmotorn ────────────────────────────────────────────────────

  /* Returnerar en lista med traffar, hogst poang forst.
     Alla soktermer maste finnas nagonstans i artikeln, alltsa OCH. */
  function sok(sokdata, fraga) {
    var ren = fraga.trim();
    if (ren.length < MIN_TECKEN) return [];
    var termer = dela(ren);
    if (!termer.length) return [];
    var fras = termer.length > 1 ? ren.toLowerCase() : null;

    var traffar = [];

    for (var i = 0; i < sokdata.artiklar.length; i++) {
      var art = sokdata.artiklar[i];
      var kvar = termer.slice();
      var poang = 0;
      var avsnittstraffar = [];

      for (var t = 0; t < termer.length; t++) {
        if (raknaTraffar(art.titel, termer[t], 1)) poang += POANG.titel;
        if (raknaTraffar(art.amne, termer[t], 1)) poang += POANG.amne;
      }

      for (var s = 0; s < art.avsnitt.length; s++) {
        var av = art.avsnitt[s];
        var avPoang = 0;

        for (var u = 0; u < termer.length; u++) {
          var term = termer[u];
          var iRubrik = raknaTraffar(av.rubrik, term, 1);
          var iText = raknaTraffar(av.text, term, TAK_PER_TERM);
          if (iRubrik) avPoang += POANG.rubrik;
          avPoang += iText * POANG.text;
          if (iRubrik || iText) {
            var index = kvar.indexOf(term);
            if (index !== -1) kvar.splice(index, 1);
          }
        }

        if (fras) {
          var frasantal = raknaTraffar(av.text, fras, TAK_PER_TERM);
          if (frasantal) {
            avPoang += frasantal * POANG.fras;
            kvar = [];
          }
        }

        if (avPoang > 0) {
          avsnittstraffar.push({
            ankare: av.ankare,
            rubrik: av.rubrik,
            poang: avPoang,
            text: av.text
          });
          poang += avPoang;
        }
      }

      // Kvar innehaller termer som inte hittades nagonstans i artikeln.
      var iTitelEllerAmne = kvar.filter(function (term) {
        return !raknaTraffar(art.titel, term, 1) && !raknaTraffar(art.amne, term, 1);
      });
      if (iTitelEllerAmne.length > 0) continue;
      if (poang <= 0) continue;

      avsnittstraffar.sort(function (a, b) { return b.poang - a.poang; });
      traffar.push({
        slug: art.slug,
        titel: art.titel,
        amne: art.amne,
        poang: poang,
        avsnitt: avsnittstraffar.slice(0, MAX_AVSNITT),
        termer: termer
      });
    }

    traffar.sort(function (a, b) { return b.poang - a.poang; });
    return traffar;
  }

  // ── Kraftsimulering ──────────────────────────────────────────────

  function Natverk(noder, kanter) {
    this.noder = noder;
    this.kanter = kanter;
    this.bredd = 800;
    this.hojd = 460;
    this.alfa = 1;
  }

  Natverk.prototype.placera = function (bredd, hojd) {
    this.bredd = bredd;
    this.hojd = hojd;
    var n = this.noder.length;
    var radie = Math.min(bredd, hojd) * 0.32;
    for (var i = 0; i < n; i++) {
      var vinkel = (i / n) * Math.PI * 2;
      this.noder[i].x = bredd / 2 + Math.cos(vinkel) * radie;
      this.noder[i].y = hojd / 2 + Math.sin(vinkel) * radie;
      this.noder[i].vx = 0;
      this.noder[i].vy = 0;
    }
    this.alfa = 1;
  };

  Natverk.prototype.tick = function () {
    var noder = this.noder;
    var n = noder.length;
    var i, j, a, b, dx, dy, avstand, kraft;

    // Frastotning mellan alla par. n ar litet, sa O(n^2) racker.
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        a = noder[i]; b = noder[j];
        dx = b.x - a.x; dy = b.y - a.y;
        avstand = Math.sqrt(dx * dx + dy * dy) || 0.01;
        kraft = 9000 / (avstand * avstand);
        var minsta = a.r + b.r + 26;
        if (avstand < minsta) kraft += (minsta - avstand) * 0.9;
        dx /= avstand; dy /= avstand;
        a.vx -= dx * kraft; a.vy -= dy * kraft;
        b.vx += dx * kraft; b.vy += dy * kraft;
      }
    }

    // Fjadrar langs kanterna. Starkare slaktskap ger kortare vilolangd.
    for (i = 0; i < this.kanter.length; i++) {
      var k = this.kanter[i];
      a = k._a; b = k._b;
      if (!a || !b) continue;
      dx = b.x - a.x; dy = b.y - a.y;
      avstand = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var vila = 190 - 110 * Math.min(1, k.vikt);
      kraft = (avstand - vila) * 0.012 * (0.35 + Math.min(1, k.vikt));
      dx /= avstand; dy /= avstand;
      a.vx += dx * kraft; a.vy += dy * kraft;
      b.vx -= dx * kraft; b.vy -= dy * kraft;
    }

    // Svag dragning mot mitten och dampning.
    var rorelse = 0;
    for (i = 0; i < n; i++) {
      a = noder[i];
      a.vx += (this.bredd / 2 - a.x) * 0.004;
      a.vy += (this.hojd / 2 - a.y) * 0.006;
      a.vx *= 0.84; a.vy *= 0.84;
      a.x += a.vx * this.alfa;
      a.y += a.vy * this.alfa;

      var marginal = a.r + 8;
      a.x = Math.max(marginal, Math.min(this.bredd - marginal, a.x));
      a.y = Math.max(marginal, Math.min(this.hojd - marginal - 16, a.y));
      rorelse += Math.abs(a.vx) + Math.abs(a.vy);
    }

    this.alfa *= 0.97;
    return rorelse / n;
  };

  Natverk.prototype.stabilisera = function (varv) {
    for (var i = 0; i < (varv || 400); i++) this.tick();
    this.alfa = 0;
  };

  // ── Allt nedan ror DOM och kors bara i webblasaren ────────────────

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      dela: dela,
      raknaTraffar: raknaTraffar,
      utdrag: utdrag,
      sok: sok,
      Natverk: Natverk
    };
  }

  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {

    var sokfalt = document.getElementById('searchInput');
    var rutnat = document.getElementById('articlesGrid');
    var behallare = document.getElementById('natverk');
    var duk = document.getElementById('natverkKanter');
    var nodlager = document.getElementById('natverkNoder');
    var traffista = document.getElementById('traffar');
    var status = document.getElementById('natverkStatus');
    var vaxel = document.getElementById('natverkVaxel');
    var tips = document.getElementById('kanttips');

    if (!sokfalt || !rutnat || !behallare || !duk || !nodlager
        || !traffista || !status) {
      console.warn('[Explorations] natverk.js: forvantade element saknas i index.html');
      return;
    }

    var natverksdata = null;
    var sokdata = null;
    var sokdataHamtas = null;
    var natverk = null;
    var nodElement = {};
    var oppen = null;
    var senasteTraffar = [];
    var senastePoang = {};
    var animation = null;
    var lugntLage = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function accentfarg() {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-color').trim();
      return v || '#c0392b';
    }

    // ── Hamtning ───────────────────────────────────────────────────

    function hamtaNatverk() {
      return fetch('natverk-index.json?v=' + Date.now(), { cache: 'no-store' })
        .then(function (svar) {
          if (!svar.ok) throw new Error('natverk-index.json gav ' + svar.status);
          return svar.json();
        });
    }

    function hamtaSok() {
      if (sokdata) return Promise.resolve(sokdata);
      if (sokdataHamtas) return sokdataHamtas;
      var stampel = natverksdata ? natverksdata.byggd : Date.now();
      sokdataHamtas = fetch('sok-index.json?v=' + encodeURIComponent(stampel))
        .then(function (svar) {
          if (!svar.ok) throw new Error('sok-index.json gav ' + svar.status);
          return svar.json();
        })
        .then(function (data) {
          sokdata = data;
          return data;
        })
        .catch(function (fel) {
          sokdataHamtas = null;
          throw fel;
        });
      return sokdataHamtas;
    }

    // ── Nodbygge ───────────────────────────────────────────────────

    function diameter(ord) {
      return Math.round(15 + 24 * Math.min(1, Math.sqrt(ord / 11000)));
    }

    function byggNoder() {
      nodlager.innerHTML = '';
      nodElement = {};
      var noder = natverksdata.artiklar.map(function (a) {
        return {
          slug: a.slug, titel: a.titel, amne: a.amne, ord: a.ord,
          kallor: a.kallor, nyckelord: a.nyckelord, avsnitt: a.avsnitt,
          r: diameter(a.ord) / 2, x: 0, y: 0, vx: 0, vy: 0
        };
      });
      var index = {};
      noder.forEach(function (n) { index[n.slug] = n; });

      var kanter = natverksdata.kanter.map(function (k) {
        return { a: k.a, b: k.b, vikt: k.vikt, termer: k.termer, _a: index[k.a], _b: index[k.b] };
      }).filter(function (k) { return k._a && k._b; });

      noder.forEach(function (n) {
        var knapp = document.createElement('button');
        knapp.type = 'button';
        knapp.className = 'nod';
        knapp.style.setProperty('--d', (n.r * 2) + 'px');
        knapp.setAttribute('data-slug', n.slug);
        knapp.setAttribute('aria-expanded', 'false');
        knapp.innerHTML = '<span class="nod-prick" aria-hidden="true"></span>'
          + '<span class="nod-etikett">' + fly(kort(n.titel)) + '</span>';
        knapp.title = n.titel + '\n' + n.amne
          + '\nNyckelord: ' + n.nyckelord.join(', ')
          + '\nKallor: ' + n.kallor.verifierade + ' av ' + n.kallor.totalt + ' verifierade';
        knapp.addEventListener('click', function () { vaxlaNod(n); });
        nodlager.appendChild(knapp);
        nodElement[n.slug] = knapp;
      });

      natverk = new Natverk(noder, kanter);
    }

    function kort(titel) {
      var kolon = titel.indexOf(':');
      var t = kolon > 6 ? titel.slice(0, kolon) : titel;
      return t.length > 30 ? t.slice(0, 29).trim() + '…' : t;
    }

    // ── Rendering ──────────────────────────────────────────────────

    function matt() {
      var rekt = behallare.getBoundingClientRect();
      return { bredd: Math.max(320, rekt.width), hojd: Math.max(300, rekt.height) };
    }

    function rita() {
      var m = matt();
      var pixelkvot = window.devicePixelRatio || 1;
      duk.width = Math.round(m.bredd * pixelkvot);
      duk.height = Math.round(m.hojd * pixelkvot);
      duk.style.width = m.bredd + 'px';
      duk.style.height = m.hojd + 'px';

      var ritare = duk.getContext('2d');
      ritare.setTransform(pixelkvot, 0, 0, pixelkvot, 0, 0);
      ritare.clearRect(0, 0, m.bredd, m.hojd);

      var accent = accentfarg();
      var soker = senasteTraffar.length > 0;

      natverk.kanter.forEach(function (k) {
        var badeTraff = soker
          && senastePoang[k.a] > 0 && senastePoang[k.b] > 0;
        ritare.beginPath();
        ritare.moveTo(k._a.x, k._a.y);
        ritare.lineTo(k._b.x, k._b.y);
        ritare.strokeStyle = accent;
        ritare.globalAlpha = badeTraff
          ? 0.30 + 0.45 * Math.min(1, k.vikt)
          : (soker ? 0.05 : 0.10 + 0.30 * Math.min(1, k.vikt));
        ritare.lineWidth = badeTraff ? 2 : 1;
        ritare.stroke();
      });

      // Kallringar. Bakre bagen ar alla kallor, framre de verifierade.
      natverk.noder.forEach(function (n) {
        var totalt = n.kallor.totalt;
        if (!totalt) return;
        var radie = n.r + 5;
        var andel = n.kallor.verifierade / totalt;
        ritare.globalAlpha = soker && !(senastePoang[n.slug] > 0) ? 0.12 : 0.25;
        ritare.beginPath();
        ritare.arc(n.x, n.y, radie, 0, Math.PI * 2);
        ritare.strokeStyle = accent;
        ritare.lineWidth = 2;
        ritare.stroke();

        if (andel > 0) {
          ritare.globalAlpha = soker && !(senastePoang[n.slug] > 0) ? 0.25 : 0.85;
          ritare.beginPath();
          ritare.arc(n.x, n.y, radie, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * andel);
          ritare.stroke();
        }
      });

      ritare.globalAlpha = 1;
      placeraNoder();
    }

    function placeraNoder() {
      natverk.noder.forEach(function (n) {
        var el = nodElement[n.slug];
        if (el) el.style.transform = 'translate(' + (n.x - n.r) + 'px,' + (n.y - n.r) + 'px)';
      });
      if (oppen) placeraSatelliter();
    }

    function animera() {
      if (animation) cancelAnimationFrame(animation);
      if (lugntLage) {
        natverk.stabilisera(500);
        rita();
        return;
      }
      var steg = function () {
        var rorelse = natverk.tick();
        rita();
        if (natverk.alfa > 0.02 && rorelse > 0.4) {
          animation = requestAnimationFrame(steg);
        } else {
          animation = null;
        }
      };
      animation = requestAnimationFrame(steg);
    }

    function starta() {
      var m = matt();
      natverk.placera(m.bredd, m.hojd);
      animera();
    }

    // ── Satelliter, alltsa avsnitt runt en oppnad nod ───────────────

    function stangSatelliter() {
      Array.prototype.forEach.call(
        nodlager.querySelectorAll('.satellit'),
        function (el) { el.remove(); }
      );
      if (oppen && nodElement[oppen.nod.slug]) {
        nodElement[oppen.nod.slug].setAttribute('aria-expanded', 'false');
        nodElement[oppen.nod.slug].classList.remove('nod-oppen');
      }
      oppen = null;
    }

    function vaxlaNod(nod) {
      var varOppen = oppen && oppen.nod.slug === nod.slug;
      stangSatelliter();
      if (varOppen) { rita(); return; }

      var traff = null;
      for (var i = 0; i < senasteTraffar.length; i++) {
        if (senasteTraffar[i].slug === nod.slug) { traff = senasteTraffar[i]; break; }
      }

      var poster = [{ etikett: 'Las hela', href: nod.slug + '/index.html' }];
      if (traff) {
        traff.avsnitt.forEach(function (a) {
          poster.push({
            etikett: a.rubrik || 'Ingress',
            href: nod.slug + '/index.html' + (a.ankare ? '#' + a.ankare : '')
          });
        });
      }

      oppen = { nod: nod, poster: poster, element: [] };

      poster.forEach(function (p) {
        var lank = document.createElement('a');
        lank.className = 'satellit';
        lank.href = p.href;
        lank.textContent = p.etikett;
        nodlager.appendChild(lank);
        oppen.element.push(lank);
      });

      nodElement[nod.slug].setAttribute('aria-expanded', 'true');
      nodElement[nod.slug].classList.add('nod-oppen');

      if (animation) { cancelAnimationFrame(animation); animation = null; }
      natverk.alfa = 0;
      rita();
    }

    function placeraSatelliter() {
      var m = matt();
      var antal = oppen.element.length;
      var radie = oppen.nod.r + 62;
      oppen.element.forEach(function (el, i) {
        var vinkel = -Math.PI / 2 + (i / Math.max(1, antal)) * Math.PI * 2;
        var x = oppen.nod.x + Math.cos(vinkel) * radie;
        var y = oppen.nod.y + Math.sin(vinkel) * radie;
        x = Math.max(4, Math.min(m.bredd - 150, x - 60));
        y = Math.max(4, Math.min(m.hojd - 26, y - 11));
        el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      });
    }

    // ── Sokning och resultat ───────────────────────────────────────

    function rensa() {
      senasteTraffar = [];
      senastePoang = {};
      stangSatelliter();
      traffista.innerHTML = '';
      traffista.hidden = true;
      rutnat.hidden = false;
      Object.keys(nodElement).forEach(function (slug) {
        nodElement[slug].classList.remove('svag');
        nodElement[slug].style.setProperty('--gloed', '0');
      });
      status.textContent = natverksdata.artiklar.length + ' essaer, '
        + natverk.kanter.length + ' slaktskap';
      rita();
    }

    function visa(traffar) {
      senasteTraffar = traffar;
      senastePoang = {};
      var hogsta = traffar.length ? traffar[0].poang : 1;
      traffar.forEach(function (t) { senastePoang[t.slug] = t.poang; });

      Object.keys(nodElement).forEach(function (slug) {
        var poang = senastePoang[slug] || 0;
        var el = nodElement[slug];
        el.classList.toggle('svag', poang === 0);
        el.style.setProperty('--gloed', poang ? (0.35 + 0.65 * (poang / hogsta)).toFixed(3) : '0');
      });

      rutnat.hidden = true;
      traffista.hidden = false;
      traffista.innerHTML = traffar.map(function (t) {
        var avsnitt = t.avsnitt.map(function (a) {
          var href = t.slug + '/index.html' + (a.ankare ? '#' + a.ankare : '');
          return '<li><a href="' + fly(href) + '">'
            + '<span class="traff-rubrik">' + fly(a.rubrik || 'Ingress') + '</span>'
            + '<span class="traff-utdrag">' + utdrag(a.text, t.termer) + '</span></a></li>';
        }).join('');
        return '<article class="traff" data-slug="' + fly(t.slug) + '">'
          + '<a class="traff-titel" href="' + fly(t.slug) + '/index.html">' + fly(t.titel) + '</a>'
          + '<span class="traff-amne">' + fly(t.amne) + '</span>'
          + '<ul class="traff-avsnitt">' + avsnitt + '</ul></article>';
      }).join('');

      status.textContent = traffar.length
        ? traffar.length + (traffar.length === 1 ? ' essa' : ' essaer')
        : 'Ingen traff';
      stangSatelliter();
      rita();
    }

    function kor() {
      var fraga = sokfalt.value;
      if (fraga.trim().length < MIN_TECKEN) { rensa(); return; }
      hamtaSok().then(function (data) {
        if (sokfalt.value !== fraga) return;
        visa(sok(data, fraga));
      }).catch(function (fel) {
        console.error('[Explorations] sokindex kunde inte laddas:', fel);
        status.textContent = 'Sokindexet kunde inte laddas. Kortvyn galler.';
        rutnat.hidden = false;
        traffista.hidden = true;
      });
    }

    // ── Kanttips vid pekare ────────────────────────────────────────

    function avstandTillKant(px, py, k) {
      var x1 = k._a.x, y1 = k._a.y, x2 = k._b.x, y2 = k._b.y;
      var dx = x2 - x1, dy = y2 - y1;
      var langd = dx * dx + dy * dy;
      var t = langd ? ((px - x1) * dx + (py - y1) * dy) / langd : 0;
      t = Math.max(0, Math.min(1, t));
      var ax = px - (x1 + t * dx), ay = py - (y1 + t * dy);
      return Math.sqrt(ax * ax + ay * ay);
    }

    if (tips && window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
      duk.addEventListener('mousemove', function (e) {
        var rekt = duk.getBoundingClientRect();
        var px = e.clientX - rekt.left, py = e.clientY - rekt.top;
        var narmast = null, kortast = 9;
        natverk.kanter.forEach(function (k) {
          var d = avstandTillKant(px, py, k);
          if (d < kortast) { kortast = d; narmast = k; }
        });
        if (narmast) {
          tips.textContent = 'Delad vokabular: ' + narmast.termer.join(', ');
          tips.style.transform = 'translate(' + (px + 14) + 'px,' + (py + 14) + 'px)';
          tips.hidden = false;
        } else {
          tips.hidden = true;
        }
      });
      duk.addEventListener('mouseleave', function () { tips.hidden = true; });
    }

    // ── Koppling ───────────────────────────────────────────────────

    var timer = null;
    sokfalt.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(kor, FORDROJNING);
    });
    sokfalt.addEventListener('focus', function () {
      hamtaSok().catch(function () { /* rapporteras nar sokningen kors */ });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (oppen) { stangSatelliter(); rita(); return; }
        if (sokfalt.value) { sokfalt.value = ''; rensa(); }
      }
      if (e.key === '/' && document.activeElement !== sokfalt) {
        e.preventDefault();
        sokfalt.focus();
      }
    });

    if (vaxel) {
      vaxel.addEventListener('click', function () {
        var pa = document.body.classList.toggle('visa-natverk');
        vaxel.setAttribute('aria-pressed', pa ? 'true' : 'false');
        if (pa) starta();
      });
    }

    var omritning = null;
    window.addEventListener('resize', function () {
      clearTimeout(omritning);
      omritning = setTimeout(function () {
        if (!natverk) return;
        starta();
      }, 200);
    });

    hamtaNatverk().then(function (data) {
      natverksdata = data;
      behallare.hidden = false;
      byggNoder();
      starta();
      rensa();
    }).catch(function (fel) {
      console.error('[Explorations] natverk-index.json kunde inte laddas:', fel);
      behallare.hidden = true;
      if (vaxel) vaxel.hidden = true;
      reservsokning();
    });

    /* Reserv: om natverksdata fattas soker vi i korten som forut,
       men utan buggen dar "read" matchar varje kort. */
    function reservsokning() {
      var kort = rutnat.querySelectorAll('.article-card');
      sokfalt.addEventListener('input', function () {
        var fraga = sokfalt.value.trim().toLowerCase();
        Array.prototype.forEach.call(kort, function (k) {
          if (!fraga) { k.hidden = false; return; }
          var falt = [
            k.getAttribute('data-title') || '',
            k.getAttribute('data-subject') || '',
            k.getAttribute('data-excerpt') || ''
          ].join(' ').toLowerCase();
          k.hidden = falt.indexOf(fraga) === -1;
        });
      });
    }
  });
})();
