// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the filters, a per-protocol detail view with the model's own breakdown and the
// protocol's farm plan, and a model sandbox. No network: every byte it shows is in data.js.
//
// The value model lives here as well as in lib/model.ts, in the same arithmetic, so the page
// recomputes every number it shows: calibratePeers rebuilds the peer multiples from the ratio
// lists, impliedOf scores a row from its snapshot figures, and farmSteps writes the plan. The
// detail view checks the recomputed value against the board's stored one.
'use strict';

/* --------------------------------------------------------------- the model, mirrored */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** The median of a sorted-ascending array (the mean of the two middles when its length is even). */
function medianSorted(sorted) {
  var n = sorted.length;
  if (n === 0) return 0;
  var mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The peer calibration, rebuilt from the per-category ratio lists: the median market-cap-to-TVL
 * ratio per category, shrunk toward the all-category median with a prior of `peer_prior` peers.
 */
function calibratePeers(ratios, model) {
  var byCategory = {};
  var all = [];
  Object.keys(ratios).forEach(function (key) {
    var list = ratios[key].slice().sort(function (a, b) { return a - b; });
    byCategory[key] = list;
    list.forEach(function (r) { all.push(r); });
  });
  all.sort(function (a, b) { return a - b; });
  var global = clamp(medianSorted(all), model.peer_min, model.peer_max);
  var out = { global: global, byCategory: {} };
  Object.keys(byCategory).forEach(function (key) {
    var list = byCategory[key];
    var med = medianSorted(list);
    var multiple = clamp((list.length * med + model.peer_prior * global) / (list.length + model.peer_prior), model.peer_min, model.peer_max);
    out.byCategory[key] = { multiple: multiple, peers: list.length };
  });
  return out;
}

/** The multiple a category prices at: its calibrated multiple, or the global one with no peers. */
function peerFor(category, peers) {
  var found = peers.byCategory[category === null || category === undefined ? '' : category];
  return found === undefined ? { multiple: peers.global, peers: 0 } : found;
}

/**
 * The implied value one row gets: TVL x peer multiple x growth x maturity. `scale` multiplies the
 * peer multiple and is 1 unless the model sandbox changes it.
 */
function impliedOf(row, peers, model, scale) {
  var growthPct = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
  var growthMult = 1 + (growthPct / 100) * model.growth_weight;
  var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
  var maturityMult = model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  var peer = peerFor(row.category, peers);
  return Math.max(1, Math.round(row.tvl_usd * peer.multiple * (scale || 1) * growthMult * maturityMult));
}

/** A typical gas cost for one transaction on a chain, as the plan's cost line states it. */
function gasFor(chain) {
  var c = chain.toLowerCase();
  if (c.indexOf('ethereum') !== -1) return '$8';
  if (c.indexOf('solana') !== -1) return '$0.05';
  if (c.indexOf('bittensor') !== -1) return '$2';
  if (c.indexOf('tron') !== -1) return '$1';
  if (c.indexOf('bsc') !== -1 || c.indexOf('bnb') !== -1 || c.indexOf('binance') !== -1) return '$0.30';
  if (c.indexOf('polygon') !== -1) return '$0.10';
  if (c.indexOf('avalanche') !== -1) return '$0.50';
  if (
    c.indexOf('arbitrum') !== -1 ||
    c.indexOf('optimism') !== -1 ||
    c.indexOf('base') !== -1 ||
    c.indexOf('blast') !== -1 ||
    c.indexOf('zksync') !== -1 ||
    c.indexOf('linea') !== -1 ||
    c.indexOf('scroll') !== -1 ||
    c.indexOf('mantle') !== -1 ||
    c.indexOf('mode') !== -1 ||
    c.indexOf('ink') !== -1 ||
    c.indexOf('unichain') !== -1 ||
    c.indexOf('world chain') !== -1
  )
    return '$0.50';
  return '$1';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(row) {
  if (row.tvl_usd >= 5000000000) return 250;
  if (row.tvl_usd >= 1000000000) return 150;
  if (row.tvl_usd >= 100000000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(row, capital, chain) {
  var c = (row.category || '').toLowerCase();
  var name = row.name;
  if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1 || c.indexOf('money market') !== -1)
    return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as a lender and leave the position open.';
  if (c.indexOf('dex') !== -1 || c.indexOf('exchange') !== -1) return 'Provide $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and keep the LP position open.';
  if (c.indexOf('yield') !== -1 || c.indexOf('leveraged farm') !== -1 || c.indexOf('farm') !== -1) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL strategy on " + chain + ' and keep the receipt tokens.';
  if (c.indexOf('bridge') !== -1 || c.indexOf('cross chain') !== -1) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
  if (c.indexOf('stak') !== -1 || c.indexOf('restak') !== -1) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
  if (c.indexOf('perpetual') !== -1 || c.indexOf('derivat') !== -1) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
  if (c.indexOf('prediction') !== -1) return 'Fund $' + capital + ' on ' + name + ' and place one position in an active market.';
  if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('risk') !== -1) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
  if (c.indexOf('stable') !== -1) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
  if (c.indexOf('rwa') !== -1) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
  if (c.indexOf('insur') !== -1) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
  if (c.indexOf('liquid') !== -1) return 'Deposit $' + capital + " into " + name + "'s liquid position on " + chain + ' and keep the receipt.';
  if (c.indexOf('option') !== -1) return 'Deposit $' + capital + ' of USDC into ' + name + "'s vault on " + chain + ' and keep the position open.';
  if (c.indexOf('launchpad') !== -1) return 'Stake or lock $' + capital + " through " + name + "'s launch allocation on " + chain + ' and join one sale.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
function farmSteps(row, age) {
  var chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var chain2 = row.chains.length > 1 ? row.chains[1] : null;
  var capital = capitalFor(row);
  var hold = holdDaysFor(age);
  var gas = gasFor(chain);
  var action = actionFor(row, capital, chain);
  var second =
    chain2 !== null
      ? 'Repeat the core position on ' + chain2 + ", the protocol's second chain, with a smaller amount, so the wallet is active on more than one chain."
      : 'Make a second, different interaction with ' + row.name + ' on ' + chain + ' — a second deposit, a swap, or a vote where the protocol offers one — so the wallet shows more than one kind of activity.';
  return [
    {
      text: 'Set up a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline, never in a screenshot or a chat.',
      cost: 'no cost to set up; the first transaction costs about ' + gas + ' of gas on ' + chain,
      time: '5 minutes',
    },
    {
      text: action,
      cost: '$' + capital + ' of capital and about ' + gas + ' of gas',
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: chain2 !== null ? 'about $' + Math.max(10, Math.round(capital / 5)) + ' of capital and about ' + gasFor(chain2) + ' of gas' : 'about ' + gas + ' of gas',
      time: '15 minutes',
    },
    {
      text: 'Make one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots.',
      cost: 'about ' + gas + ' of gas a week',
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days, so the activity is counted in more than one snapshot instead of a single week.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: 'Before withdrawing, check whether ' + row.name + ' publishes a points or rewards page, and claim only through a link the protocol itself publishes; record the wallet, the dates and every transaction in a farm log.',
      cost: 'nothing to check, and never pay anyone to claim',
      time: '10 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 597) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page for news.';
  return s;
}

/* --------------------------------------------------------------- the page */

if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.RADAR) {
  init(window.RADAR);
}

function init(DATA) {
  var PEERS = calibratePeers(DATA.peer_ratios, DATA.model);
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'implied', dir: -1, tab: 'pre', selected: null, override: null, scale: 1 };
  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function catName(c) { return c === null || c === undefined || c === '' ? 'Uncategorised' : c; }
  function chainList(chains) {
    if (chains.length === 0) return '—';
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  /** Every row with its display value and its rank under the current model. */
  function scoredRows() {
    var model = state.override || DATA.model;
    var scored = DATA.rows.map(function (r) {
      var implied = state.override ? impliedOf(r, PEERS, model, state.scale) : r.implied_value_usd;
      return { row: r, implied: implied };
    });
    var ranked = scored.slice().sort(function (a, b) {
      return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    var rankOf = {};
    ranked.forEach(function (s, i) { rankOf[s.row.slug] = i + 1; });
    scored.forEach(function (s) { s.displayRank = rankOf[s.row.slug]; });
    return scored;
  }

  function matches(row) {
    if (state.category !== 'all' && (row.category || '') !== state.category) return false;
    if (state.chain !== 'all' && row.chains.indexOf(state.chain) === -1) return false;
    if (state.watchOnly && !row.on_watchlist) return false;
    if (state.q) {
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + row.chains.join(' ')).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function sortScored(scored) {
    var dir = state.dir;
    var key = state.sort;
    return scored.sort(function (a, b) {
      var r;
      if (key === 'tvl') r = a.row.tvl_usd - b.row.tvl_usd;
      else if (key === 'change') r = (a.row.change_7d === null ? -Infinity : a.row.change_7d) - (b.row.change_7d === null ? -Infinity : b.row.change_7d);
      else if (key === 'age') r = (a.row.age_days === null ? -Infinity : a.row.age_days) - (b.row.age_days === null ? -Infinity : b.row.age_days);
      else if (key === 'name') r = a.row.name.toLowerCase() < b.row.name.toLowerCase() ? -1 : a.row.name.toLowerCase() > b.row.name.toLowerCase() ? 1 : 0;
      else r = a.implied - b.implied;
      if (r === 0) r = a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
      return r * dir;
    });
  }

  function renderStats(scored) {
    var total = scored.reduce(function (n, s) { return n + s.implied; }, 0);
    $('stats').innerHTML =
      '<div><dt>Watchlist covered</dt><dd>' + DATA.watchlist_size + ' <small>/ ' + DATA.watchlist_size + '</small></dd></div>' +
      '<div><dt>Pre-token rows scored</dt><dd>' + DATA.board_size + '</dd></div>' +
      '<div><dt>Early rows below the floor</dt><dd>' + DATA.early_size + '</dd></div>' +
      '<div><dt>Total implied value</dt><dd>' + fmtUsd(total) + '</dd></div>';
  }

  function renderPeers() {
    var keys = Object.keys(PEERS.byCategory).sort(function (a, b) {
      return PEERS.byCategory[b].peers - PEERS.byCategory[a].peers || (a < b ? -1 : a > b ? 1 : 0);
    });
    var html = '<table><thead><tr><th>Category</th><th>Trading peers</th><th>Peer multiple</th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var p = PEERS.byCategory[k];
      html += '<tr><td>' + esc(catName(k)) + '</td><td class="num">' + p.peers + '</td><td class="num">' + p.multiple.toFixed(3) + '×</td></tr>';
    });
    html += '<tr><td>All categories (fallback)</td><td class="num">—</td><td class="num">' + PEERS.global.toFixed(3) + '×</td></tr></tbody></table>';
    $('peer-table').innerHTML = html;
  }

  function renderTable() {
    var scored = scoredRows();
    renderStats(scored);
    var maxImplied = scored.reduce(function (n, s) { return Math.max(n, s.implied); }, 1);
    var filtered = sortScored(scored.filter(function (s) { return matches(s.row); }));
    var html = filtered.map(function (s) {
      var r = s.row;
      var pct = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var pctClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var bar = Math.max(2, Math.round((s.implied / maxImplied) * 100));
      return '<tr tabindex="0" data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + s.displayRank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + (r.on_watchlist ? '<span class="badge">Watchlist</span>' : '') + '</span>' +
        '<span class="psub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(catName(r.category)) + '</td>' +
        '<td><span class="chains">' + esc(chainList(r.chains)) + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass + '">' + pct + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><span class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></span>' + fmtUsd(s.implied) + '</td></tr>';
    }).join('');
    $('rows').innerHTML = html;
    $('empty').hidden = filtered.length !== 0;
    $('count').textContent = filtered.length === DATA.board_size ? filtered.length + ' rows shown' : filtered.length + ' of ' + DATA.board_size + ' rows shown';
    $('board-note').textContent = state.override
      ? 'Recomputed values under the changed model — the board re-ranks live. Select a row for its value breakdown and farm plan.'
      : 'Pre-token protocols, strongest implied value first. Select a row for its value breakdown and farm plan.';
    var headers = document.querySelectorAll('#board-table thead th[data-sort]');
    headers.forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var active = (key === 'rank' || key === 'implied') ? (state.sort === 'implied' || state.sort === 'rank') : state.sort === key;
      if (active) th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function renderLive() {
    var rows = DATA.live.filter(function (r) {
      if (state.category !== 'all' && (r.category || '') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
    $('live-rows').innerHTML = rows.map(function (r) {
      var pct = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var pctClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      return '<tr><td><span class="pname">' + esc(r.name) + '<span class="badge live">Trading</span></span>' +
        '<span class="psub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(catName(r.category)) + '</td>' +
        '<td><span class="chains">' + esc(chainList(r.chains)) + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num ' + pctClass + '">' + pct + '</td></tr>';
    }).join('');
    $('empty').hidden = rows.length !== 0;
    $('count').textContent = rows.length + ' of ' + DATA.live_size + ' live-token protocols shown';
    $('board-note').textContent = 'Protocols whose token already trades, strongest market cap first. Market values, not ranked — kept apart from the pre-token board.';
  }

  function renderDetail() {
    var drawer = $('detail');
    var scrim = $('scrim');
    if (!state.selected || !bySlug[state.selected]) {
      drawer.hidden = true;
      scrim.hidden = true;
      return;
    }
    var r = bySlug[state.selected];
    var peer = peerFor(r.category, PEERS);
    var growthPct = clamp(r.change_7d === null ? 0 : r.change_7d, DATA.model.growth_floor, DATA.model.growth_cap);
    var growthMult = 1 + (growthPct / 100) * DATA.model.growth_weight;
    var ageForModel = r.age_days === null ? DATA.model.unknown_age_days : r.age_days;
    var maturityMult = DATA.model.maturity_floor + (clamp(ageForModel, 0, DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    var recomputed = impliedOf(r, PEERS, DATA.model, 1);
    var steps = farmSteps(r, r.age_days);
    var plan = steps.map(function (s) {
      return '<li>' + esc(s.text) + '<span class="cost-time"><b>Cost:</b> ' + esc(s.cost) + '. <b>Time:</b> ' + esc(s.time) + '.</span></li>';
    }).join('');
    $('detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="dsub">' + esc(catName(r.category)) + ' · ' + esc(r.chains.length ? r.chains.join(', ') : 'no chains listed') + ' · ' + esc(r.slug) + '</p>' +
      '<p class="dstatus"><span class="dot">●</span> Records no token' + (r.on_watchlist ? ' · <span class="badge">Watchlist</span>' : ' · Early find below the floor') + '</p>' +
      '<dl class="dgrid">' +
      '<div><dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + fmtPct(r.change_7d) + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + fmtUsd(r.implied_value_usd) + '</dd></div>' +
      '</dl>' +
      '<h3>Value breakdown</h3>' +
      '<table class="breakdown"><thead><tr><th>Input</th><th>Figure</th></tr></thead><tbody>' +
      '<tr><td>TVL</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Peer multiple (' + peer.peers + ' trading peer' + (peer.peers === 1 ? '' : 's') + ' in ' + esc(catName(r.category)) + ')</td><td class="num">' + peer.multiple.toFixed(4) + '×</td></tr>' +
      '<tr><td>Growth (' + fmtPct(growthPct) + ' over 7 days, clamped)</td><td class="num">' + growthMult.toFixed(4) + '×</td></tr>' +
      '<tr><td>Maturity (' + fmtAge(r.age_days) + ' running)</td><td class="num">' + maturityMult.toFixed(4) + '×</td></tr>' +
      '<tr class="total"><td>Implied value</td><td class="num">' + fmtUsd(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="recheck">Recomputed in this page from the snapshot figures: ' + fmtUsd(recomputed) + (recomputed === r.implied_value_usd ? ' — matches the board.' : ' — differs from the board by ' + fmtUsd(Math.abs(recomputed - r.implied_value_usd)) + '.') + '</p>' +
      '<h3>Farm plan</h3><ol class="plan">' + plan + '</ol>' +
      '<p class="dnote">The implied value is the entry\'s own model, not a promise and not a prediction that a token will be issued. Costs are typical gas and capital for one position; check the protocol\'s own pages before acting.</p>';
    drawer.hidden = false;
    scrim.hidden = false;
  }

  function render() {
    var pre = state.tab === 'pre';
    $('tab-pre').setAttribute('aria-selected', pre ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', pre ? 'false' : 'true');
    $('board-table').hidden = !pre;
    $('live-table').hidden = pre;
    if (pre) renderTable();
    else renderLive();
    renderDetail();
  }

  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchOnly) parts.push('watch=1');
    if (state.sort !== 'implied') parts.push('sort=' + encodeURIComponent(state.sort));
    if (state.dir !== -1) parts.push('dir=1');
    if (state.tab !== 'pre') parts.push('tab=live');
    var qs = parts.length ? '?' + parts.join('&') : '';
    var base = state.selected ? '#/protocol/' + encodeURIComponent(state.selected) : '#/';
    history.replaceState(null, '', base + qs);
  }

  function readHash() {
    var raw = window.location.hash.replace(/^#\/?/, '');
    var split = raw.split('?');
    var path = split[0] || '';
    var params = new URLSearchParams(split[1] || '');
    state.q = params.get('q') || '';
    state.category = params.get('cat') || 'all';
    state.chain = params.get('chain') || 'all';
    state.watchOnly = params.get('watch') === '1';
    state.sort = params.get('sort') || 'implied';
    state.dir = params.get('dir') === '1' ? 1 : -1;
    state.tab = params.get('tab') === 'live' ? 'live' : 'pre';
    if (path.indexOf('protocol/') === 0) {
      var slug = decodeURIComponent(path.slice('protocol/'.length));
      state.selected = bySlug[slug] ? slug : null;
    } else {
      state.selected = null;
    }
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watch-only').checked = state.watchOnly;
    $('sort').value = state.sort;
  }

  function selectRow(slug) {
    state.selected = slug;
    writeHash();
    render();
    if (slug) $('detail-close').focus();
  }

  /* Controls */
  var categories = {};
  var chains = {};
  DATA.rows.concat(DATA.live).forEach(function (r) {
    categories[r.category || ''] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(categories).sort().forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = catName(c);
    $('category').appendChild(opt);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    $('chain').appendChild(opt);
  });

  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); writeHash(); render(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
  $('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; writeHash(); render(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    writeHash();
    render();
  });
  $('tab-pre').addEventListener('click', function () { state.tab = 'pre'; writeHash(); render(); });
  $('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
  $('clear-filters').addEventListener('click', function () {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    $('q').value = '';
    $('category').value = 'all';
    $('chain').value = 'all';
    $('watch-only').checked = false;
    writeHash();
    render();
  });
  document.querySelectorAll('#board-table thead th[data-sort] button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.parentElement.getAttribute('data-sort');
      var sortKey = key === 'rank' ? 'implied' : key;
      if (state.sort === sortKey) state.dir = -state.dir;
      else {
        state.sort = sortKey;
        state.dir = sortKey === 'name' ? 1 : -1;
      }
      $('sort').value = state.sort;
      writeHash();
      render();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) selectRow(tr.getAttribute('data-slug'));
  });
  $('rows').addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
      e.preventDefault();
      selectRow(e.target.getAttribute('data-slug'));
    }
  });
  $('detail-close').addEventListener('click', function () { selectRow(null); });
  $('scrim').addEventListener('click', function () { selectRow(null); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) selectRow(null);
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });

  /* Model sandbox */
  $('sb-growth').value = DATA.model.growth_weight;
  $('sb-maturity').value = DATA.model.maturity_floor;
  $('sb-scale').value = 1;
  function applySandbox() {
    var gw = parseFloat($('sb-growth').value);
    var mf = parseFloat($('sb-maturity').value);
    var sc = parseFloat($('sb-scale').value);
    if (!isFinite(gw) || !isFinite(mf) || !isFinite(sc)) return;
    var changed = gw !== DATA.model.growth_weight || mf !== DATA.model.maturity_floor || sc !== 1;
    if (!changed) {
      state.override = null;
      state.scale = 1;
    } else {
      var m = {};
      Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
      m.growth_weight = clamp(gw, 0, 1);
      m.maturity_floor = clamp(mf, 0.4, 0.9);
      m.maturity_range = 1 - m.maturity_floor;
      state.override = m;
      state.scale = clamp(sc, 0.5, 2);
    }
    $('sandbox-note').hidden = !changed;
    render();
  }
  ['sb-growth', 'sb-maturity', 'sb-scale'].forEach(function (id) {
    $(id).addEventListener('input', applySandbox);
  });
  $('sb-reset').addEventListener('click', function () {
    $('sb-growth').value = DATA.model.growth_weight;
    $('sb-maturity').value = DATA.model.maturity_floor;
    $('sb-scale').value = 1;
    state.override = null;
    state.scale = 1;
    $('sandbox-note').hidden = true;
    render();
  });

  /* First paint */
  $('meta').textContent = 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model';
  renderPeers();
  readHash();
  render();
}
