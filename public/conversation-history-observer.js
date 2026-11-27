/**
 * Conversation History Observer — injected into the MAIN world at
 * document_start (via usageObserverLoader) so it can hook the network BEFORE
 * Gemini bootstraps and fires the conversation-load RPC.
 *
 * Gemini loads a conversation's messages through a `batchexecute` RPC
 * (rpcid `hNvQHb`) whose payload carries a server-side `[seconds, nanos]`
 * timestamp and stable response id for every turn. Captures stay buffered only until the isolated
 * content script acknowledges them; SPA navigation therefore never replays
 * already-parsed multi-megabyte responses.
 *
 * The observer starts in an `unknown` state until the document_start loader
 * confirms that the isolated-world parser is ready. It preserves only a small
 * bounded set of responses during that short race so eager conversation-load
 * RPCs are not lost.
 *
 * The fetch wrapper deliberately returns the original promise. Making it an
 * async wrapper breaks Angular's zone.js change detection (see
 * public/fetchInterceptor.js).
 *
 * Every history request also posts a small `request` start/end message, whatever
 * the capture state: export preloading waits on it instead of guessing from time
 * whether an older page is still on its way.
 */
(function () {
  if (window.__gvHistoryObserverInstalled) return;
  window.__gvHistoryObserverInstalled = true;

  var SRC = 'gv-history-observer';
  var CMD = 'gv-history-observer-cmd';
  var MAX_BUFFER_COUNT = 4;
  var MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
  var MAX_BUFFER_BYTES = 24 * 1024 * 1024;
  var observerId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  var sequence = 0;
  var state = 'unknown';
  var readGeneration = 0;
  var unknownReadClaimed = false;
  var bufferedBytes = 0;
  var buffer = [];
  var origFetch = window.fetch;
  var timelineRecipe = null;
  var timelineSession = null;

  // Reuse only the current conversation's native read request. The form token and
  // the server's continuation cursor stay in this closure, even when the rail stops.
  function timelineRequestSource(method, url) {
    var path = location.pathname;
    var route = /^(\/u\/\d+)?\/(?:app|gem\/[^/]+)\/([a-f0-9]{8,})\/?$/i.exec(path);
    if (!route || state === 'disabled' || location.origin !== 'https://gemini.google.com')
      return null;
    if (String(method).toUpperCase() !== 'POST') return null;
    try {
      var endpoint = new URL(url, location.href);
      if (
        endpoint.origin !== location.origin ||
        endpoint.pathname !== (route[1] || '') + '/_/BardChatUi/data/batchexecute' ||
        endpoint.searchParams.get('source-path') !== path ||
        endpoint.searchParams.get('rpcids') !== 'hNvQHb'
      )
        return null;
      return { path: path, cid: 'c_' + route[2].toLowerCase(), endpoint: endpoint };
    } catch (e) {
      return null;
    }
  }

  function timelineRequest(source, body) {
    if (!source || source.path !== location.pathname) return null;
    if (body instanceof URLSearchParams) body = body.toString();
    if (typeof body !== 'string' || body.length > 8192) return null;
    try {
      var form = new URLSearchParams(body);
      var token = form.get('at');
      const batches = JSON.parse(form.get('f.req'));
      if (!token || batches.length !== 1 || batches[0].length !== 1) return null;
      const [rpc, raw, unused, type] = batches[0][0];
      if (rpc !== 'hNvQHb' || unused !== null || type !== 'generic') return null;
      const args = JSON.parse(raw);
      if (!Array.isArray(args) || args[0] !== source.cid || args[2] !== null) return null;
      const size = args[1];
      if (!Number.isInteger(size) || size < 1 || size > 50) return null;
      return { ...source, token, args };
    } catch (e) {
      return null;
    }
  }

  function timelineFetchRequest(input, init, url) {
    var source = timelineRequestSource(init?.method || input?.method, url);
    if (!source) return null;
    if (init?.body != null) return timelineRequest(source, init.body);
    // Gemini's Fetch transport supplies a Request rather than a separate init.
    // Clone before passthrough so the host is still the sole reader of its body.
    try {
      if (!(input instanceof Request) || !input.body) return null;
      return input
        .clone()
        .text()
        .then(
          (body) => timelineRequest(source, body),
          () => null,
        );
    } catch (e) {
      return null;
    }
  }

  function readTimelinePage(body, cid) {
    if (typeof body !== 'string' || estimateStringBytes(body) > MAX_CAPTURE_BYTES) return null;
    // Gemini's batchexecute sends each JSON frame on a single line, with a size line before it.
    for (var line of body.split('\n')) {
      if (line[0] !== '[') continue;
      try {
        const rpc = JSON.parse(line).find(
          ([kind, id, data]) => kind === 'wrb.fr' && id === 'hNvQHb' && typeof data === 'string',
        );
        if (!rpc) continue;
        const [turns, next] = JSON.parse(rpc[2]);
        if (!Array.isArray(turns) || (next != null && (typeof next !== 'string' || !next)))
          return null;
        const summaries = [];
        for (const turn of turns) {
          const identity = turn?.[0];
          if (!Array.isArray(identity) || identity[0] !== cid) return null;
          const id = identity[1];
          if (typeof id !== 'string' || !/^(?:r_)?[a-f0-9]{8,}$/i.test(id)) return null;
          const text = turn[2]?.[0]?.[0];
          summaries.push([id, typeof text === 'string' ? text.slice(0, 4000) : '']);
        }
        return { turns: summaries, next: next || null };
      } catch (e) {}
    }
    return null;
  }

  function retireTimelineSession() {
    timelineSession?.controller?.abort();
    timelineSession = null;
  }

  function rememberTimelineRecipe(recipe, body) {
    if (!recipe || recipe.path !== location.pathname) return;
    const first = readTimelinePage(body, recipe.cid);
    if (!first) return;
    timelineRecipe = { ...recipe, first: first };
    if (timelineSession?.path === recipe.path && !timelineSession.started)
      void readTimelinePages(timelineSession, timelineRecipe);
  }

  function startTimelineHistory(payload) {
    if (!payload || !origFetch || state === 'disabled') return;
    const { id, path } = payload;
    if (path !== location.pathname || typeof id !== 'string') return;
    if (timelineSession?.id === id) return;
    retireTimelineSession();
    timelineSession = { id, path, controller: new AbortController() };
    if (timelineRecipe?.path === path) void readTimelinePages(timelineSession, timelineRecipe);
  }

  async function readOlderTimelinePage(recipe, cursor, signal) {
    const endpoint = new URL(recipe.endpoint);
    endpoint.searchParams.set('_reqid', String(100000 + Math.floor(Math.random() * 800000)));
    const args = recipe.args.slice();
    args[2] = cursor;
    const body = new URLSearchParams({
      'f.req': JSON.stringify([[['hNvQHb', JSON.stringify(args), null, 'generic']]]),
      at: recipe.token,
    });
    const response = await origFetch.call(window, endpoint.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1',
      },
      body: body.toString(),
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    });
    return response.ok ? readTimelinePage(await response.text(), recipe.cid) : null;
  }

  async function readTimelinePages(session, recipe) {
    session.started = true;
    const { id, path, controller } = session;
    const seen = new Set();
    let data = recipe.first;
    for (let page = 0; path === location.pathname && session === timelineSession; page++) {
      const next = data?.next;
      const hasOlder = page < 300 && !!next && !!data.turns.length && !seen.has(next);
      post('timeline-page', { id, path, page, turns: data?.turns || [], hasOlder });
      if (!hasOlder) return;
      seen.add(next);
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        data = await readOlderTimelinePage(recipe, next, controller.signal);
      } catch (e) {
        data = null;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  function isHistoryRequest(url) {
    var s = String(url || '');
    return s.indexOf('batchexecute') > -1 && s.indexOf('hNvQHb') > -1;
  }

  function post(type, payload) {
    try {
      window.postMessage({ source: SRC, type: type, payload: payload }, location.origin);
    } catch (e) {}
  }

  function estimateStringBytes(value) {
    return value.length * 2;
  }

  function removeAt(index) {
    var removed = buffer.splice(index, 1)[0];
    if (removed) bufferedBytes = Math.max(0, bufferedBytes - removed.bytes);
  }

  function clearBuffer() {
    buffer.length = 0;
    bufferedBytes = 0;
  }

  function acknowledge(id) {
    if (typeof id !== 'string' || !id) return;
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i].id === id) {
        removeAt(i);
        return;
      }
    }
  }

  function claimResponseRead() {
    if (state === 'disabled') return null;
    if (state === 'unknown') {
      if (unknownReadClaimed) return null;
      unknownReadClaimed = true;
    }
    return readGeneration;
  }

  function capture(url, body, generation, recipe) {
    if (generation !== readGeneration || state === 'disabled') return;
    if (typeof body !== 'string' || !body) return;

    var bytes = estimateStringBytes(body);
    if (bytes > MAX_CAPTURE_BYTES || bytes > MAX_BUFFER_BYTES) return;
    if (recipe)
      Promise.resolve(recipe).then(function (request) {
        if (generation === readGeneration && state !== 'disabled')
          rememberTimelineRecipe(request, body);
      });

    while (
      buffer.length > 0 &&
      (buffer.length >= MAX_BUFFER_COUNT || bufferedBytes + bytes > MAX_BUFFER_BYTES)
    ) {
      removeAt(0);
    }
    if (buffer.length >= MAX_BUFFER_COUNT || bufferedBytes + bytes > MAX_BUFFER_BYTES) return;

    var item = {
      id: observerId + ':' + String(++sequence),
      url: String(url),
      body: body,
      bytes: bytes,
    };
    buffer.push(item);
    bufferedBytes += bytes;
    post('capture', { id: item.id, url: item.url, body: item.body });
  }

  function configure(enabled) {
    if (enabled) {
      state = 'enabled';
      return;
    }

    state = 'disabled';
    readGeneration++;
    unknownReadClaimed = false;
    clearBuffer();
    retireTimelineSession();
    timelineRecipe = null;
  }

  // Install the command bridge before network hooks so a fast setting read can
  // configure the observer as soon as the external script executes.
  function handleCommand(ev) {
    if (ev.source !== window || ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.source !== CMD) return;
    if (d.type === 'timeline-start') {
      startTimelineHistory(d.payload);
      return;
    }
    if (d.type === 'timeline-stop' && timelineSession?.id === d.payload?.id) {
      retireTimelineSession();
      return;
    }

    if (d.type === 'configure') {
      configure(!!(d.payload && d.payload.enabled));
      return;
    }
    if (d.type === 'ack') {
      acknowledge(d.payload && d.payload.id);
      return;
    }
    if (d.type === 'flush') {
      for (var i = 0; i < buffer.length; i++) {
        var item = buffer[i];
        post('capture', { id: item.id, url: item.url, body: item.body });
      }
    }
  }
  window.addEventListener('message', handleCommand);

  // --- fetch hook (regular function — must not wrap the passthrough promise) ---
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
      var observesHistory = isHistoryRequest(url);
      var recipe = observesHistory ? timelineFetchRequest(input, init, url) : null;
      var p = origFetch.apply(this, arguments);
      if (observesHistory) {
        post('request', { phase: 'start' });
        var ended = false;
        var end = function () {
          if (ended) return;
          ended = true;
          post('request', { phase: 'end' });
        };
        p.then(function (r) {
          if (!r || typeof r.clone !== 'function') {
            end();
            return r;
          }
          var generation = claimResponseRead();
          if (generation === null) {
            end();
            return r;
          }
          try {
            // End only once the body has arrived: on a slow link it trails the headers by seconds.
            r.clone()
              .text()
              .then(function (t) {
                end();
                capture(url, t, generation, recipe);
              }, end);
          } catch (e) {
            end();
          }
          return r;
        }, end);
      }
      return p;
    };
  }

  // --- XHR hook ---
  if (typeof window.XMLHttpRequest === 'function') {
    var OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      var xhr = new OrigXHR();
      var reqUrl = '';
      var reqMethod = '';

      var origOpen = xhr.open;
      xhr.open = function (method, url) {
        reqMethod = method;
        reqUrl = String(url || '');
        return origOpen.apply(xhr, arguments);
      };

      var origSend = xhr.send;
      xhr.send = function (body) {
        if (isHistoryRequest(reqUrl)) {
          var recipe = timelineRequest(timelineRequestSource(reqMethod, reqUrl), body);
          post('request', { phase: 'start' });
          xhr.addEventListener(
            'loadend',
            function () {
              post('request', { phase: 'end' });
            },
            { once: true },
          );
          xhr.addEventListener(
            'load',
            function () {
              try {
                if (xhr.responseType && xhr.responseType !== 'text') return;
                var generation = claimResponseRead();
                if (generation === null) return;
                capture(reqUrl, xhr.responseText, generation, recipe);
              } catch (e) {}
            },
            { once: true },
          );
        }
        return origSend.apply(xhr, arguments);
      };

      return xhr;
    };
    // Page code reads XMLHttpRequest.DONE and checks instanceof; keep the native constructor's statics and prototype.
    Object.setPrototypeOf(window.XMLHttpRequest, OrigXHR);
    window.XMLHttpRequest.prototype = OrigXHR.prototype;
  }

  window.addEventListener(
    'beforeunload',
    function () {
      window.removeEventListener('message', handleCommand);
      clearBuffer();
      retireTimelineSession();
      timelineRecipe = null;
    },
    { once: true },
  );

  post('ready', { observerId: observerId });
})();
