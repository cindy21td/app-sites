// Dim Sum Teahouse shared table page: /dimsumsort/table/?c=DSS1-…
// The app (1.2+) shares this link; it has no universal link, so this page hands the code to the app through its
// URL scheme (dimsumsort://table/<code>, the same text the app's onOpenURL decodes) and the Smart App Banner.
// The code is untrusted. It must match CODE_RE before it is used anywhere, and it is drawn only after the same
// checks as the app's TableCode.decode + check() (ios/SteamerRules/Sources/SteamerRules/TableCode.swift in
// dim-sum-sort). The page never writes it as HTML: only textContent and an encoded URL.
(function () {
  'use strict';

  var PREFIX = 'DSS1-';
  var CODE_RE = /^DSS1-[A-Za-z0-9_-]{8,200}$/;
  var PLACES_PER_CART = 16;
  var DISHES = {
    1: { name: 'har gow', key: 'hargow', mark: 'HG' },
    2: { name: 'siu mai', key: 'siumai', mark: 'SM' },
    3: { name: 'char siu bao', key: 'bao', mark: 'B' },
    4: { name: 'lo mai gai', key: 'lmg', mark: 'LMG' },
    5: { name: 'turnip cake', key: 'turnip', mark: 'TC' },
    6: { name: 'sesame balls', key: 'sesame', mark: 'SB' },
    7: { name: 'nian gao', key: 'niangao', mark: 'NG' },
  };

  function readCode() {
    var raw;
    try {
      raw = new URLSearchParams(window.location.search).get('c');
    } catch (e) {
      return null;
    }
    if (raw == null) return null;
    raw = raw.trim();
    return CODE_RE.test(raw) ? raw : null;
  }

  // Swift's checksum: fold from 0x5A with (acc * 31 + byte) mod 256.
  function checksum(bytes) {
    var acc = 0x5a;
    for (var i = 0; i < bytes.length; i++) acc = (Math.imul(acc, 31) + bytes[i]) & 0xff;
    return acc;
  }

  function dishSet(mask) {
    if (mask === 0 || (mask & ~0x1e) !== 0) return null; // the code's carts serve the four everyday dishes only
    var out = [];
    for (var d = 1; d <= 4; d++) if (mask & (1 << d)) out.push(d);
    return out;
  }

  function steamer(b) {
    var dish = b & 0x07;
    if (b === 0 || !DISHES[dish]) return null;
    return { dish: dish, ticket: b >> 3 };
  }

  // TableCode.cleanName: letters, digits, spaces and . ' - &, single spaces, at most 24 characters.
  function isCleanName(s) {
    if (Array.from(s).length > 24) return false;
    if (!/^[\p{L}\p{Nd} .'\-&]*$/u.test(s)) return false;
    return s === s.split(' ').filter(Boolean).join(' ');
  }

  /** Decodes and checks a code exactly as the app does; null when the app would refuse it. */
  function decode(code) {
    var b64 = code.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    var bin;
    try {
      bin = atob(b64);
    } catch (e) {
      return null;
    }
    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
    if (bytes.length < 8 || bytes[0] !== 1) return null;
    if (checksum(bytes.slice(0, -1)) !== bytes[bytes.length - 1]) return null;
    var w = bytes[1],
      h = bytes[2],
      hands = bytes[3];
    if (w < 2 || w > 4 || h < 1 || h > 3 || hands < 1 || hands > 3) return null;
    var red = dishSet(bytes[4]),
      jade = dishSet(bytes[5]);
    if (!red || !jade) return null;
    var places = w * h;
    if (bytes.length < 6 + 2 * places + 2) return null;
    var at = 6;
    var carts = [[], []];
    for (var side = 0; side < 2; side++) {
      for (var p = 0; p < places; p++) {
        var b = bytes[at++];
        if (b !== 0 && !steamer(b)) return null;
        carts[side].push(b);
      }
    }
    var nameLen = bytes[at++];
    if (bytes.length !== at + nameLen + 1) return null;
    var setter;
    try {
      setter = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes.slice(at, at + nameLen)));
    } catch (e) {
      return null;
    }
    if (!isCleanName(setter)) return null;

    // check(): piles pack to the back wall, every dish has a cart, paired tickets come in twos.
    var served = red.concat(jade);
    var tickets = {};
    var count = 0;
    for (side = 0; side < 2; side++) {
      for (var tier = 0; tier < h; tier++) {
        var gap = false;
        for (var step = 0; step < w; step++) {
          var x = side === 0 ? step : w - 1 - step; // red's back wall is column 0, jade's the last column
          var byte = carts[side][tier * w + x];
          if (byte === 0) {
            gap = true;
            continue;
          }
          if (gap) return null;
          var s = steamer(byte);
          count++;
          if (served.indexOf(s.dish) < 0) return null;
          if (s.ticket !== 0) tickets[s.ticket] = (tickets[s.ticket] || 0) + 1;
        }
      }
    }
    if (count === 0) return null;
    for (var t in tickets) if (tickets[t] !== 2) return null;
    if (places > PLACES_PER_CART) return null;
    return { width: w, tiers: h, hands: hands, serves: [red, jade], carts: carts, setter: setter };
  }

  var code = readCode();
  var deepLink = code ? 'dimsumsort://table/' + encodeURIComponent(code) : null;

  // Runs in <head>: give the Smart App Banner's Open button the code.
  if (deepLink) {
    var banner = document.querySelector('meta[name="apple-itunes-app"]');
    if (banner) banner.setAttribute('content', 'app-id=6826953098, app-argument=' + deepLink);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function drawCart(table, side) {
    var cart = el('div', 'cart ' + (side === 0 ? 'red' : 'jade'));
    var sign = el('p', 'sign', 'serves ' + table.serves[side].map((d) => DISHES[d].name).join(', '));
    cart.appendChild(sign);
    for (var tier = 0; tier < table.tiers; tier++) {
      var row = el('div', 'tier');
      for (var x = 0; x < table.width; x++) {
        var s = steamer(table.carts[side][tier * table.width + x]);
        if (!s) {
          row.appendChild(el('span', 'place empty'));
          continue;
        }
        var cell = el('span', 'place steamer ' + DISHES[s.dish].key, DISHES[s.dish].mark);
        cell.title = DISHES[s.dish].name + (s.ticket ? ', ticket ' + s.ticket : '');
        if (s.ticket) cell.appendChild(el('span', 'ticket', String(s.ticket)));
        row.appendChild(cell);
      }
      cart.appendChild(row);
    }
    return cart;
  }

  function steamerCount(table) {
    return table.carts[0].concat(table.carts[1]).filter((b) => b !== 0).length;
  }

  function render() {
    var $ = (id) => document.getElementById(id);
    if (!code) {
      if (new URLSearchParams(window.location.search).has('c')) $('bad').hidden = false;
      return;
    }
    $('code').textContent = code;
    $('code-wrap').hidden = false;
    $('open').setAttribute('href', deepLink);
    $('open-wrap').hidden = false;
    $('later').hidden = false;

    var table = decode(code);
    if (table) {
      if (table.setter) $('title').textContent = table.setter + ' set you a table';
      $('lead').textContent =
        steamerCount(table) +
        ' steamers on two carts, ' +
        table.hands +
        (table.hands === 1 ? ' steamer' : ' steamers') +
        ' in hand at a time.';
      var box = $('table');
      box.appendChild(drawCart(table, 0));
      box.appendChild(el('div', 'aisle'));
      box.appendChild(drawCart(table, 1));
      box.setAttribute(
        'aria-label',
        'The table: red cart serves ' +
          table.serves[0].map((d) => DISHES[d].name).join(', ') +
          '; jade cart serves ' +
          table.serves[1].map((d) => DISHES[d].name).join(', '),
      );
      box.hidden = false;
    }

    // Try the app once per visit. Without the app, iOS may show a short "cannot open" notice; the page stays.
    var key = 'dss-opened-' + code;
    var tried = false;
    try {
      tried = sessionStorage.getItem(key) === '1';
      sessionStorage.setItem(key, '1');
    } catch (e) {
      tried = false;
    }
    if (!tried && /iPhone|iPad|iPod/.test(navigator.userAgent)) window.location.href = deepLink;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
