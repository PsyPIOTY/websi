/*
 * WEBSI-Bridge. Läuft in der Website, die im Editor angezeigt wird.
 * Findet die Abschnitte, hängt unter jeden ein Nachrichtenfeld und spricht
 * per postMessage mit dem Dashboard. Ändert nichts an der Website selbst,
 * außer etwas Abstand unter jedem Abschnitt, solange der Editor offen ist.
 *
 * Protokoll (Typen in core/bridge/protocol.ts):
 *   Bridge → Dashboard: websi:hello, websi:ready, websi:submit, websi:open, websi:visible, websi:scroll
 *   Dashboard → Bridge: websi:config, websi:state, websi:scrollTo, websi:scrollY, websi:mode
 *
 * Im Vergleich (mode "compare") gibt es keine Felder; die Bridge meldet nur
 * den Scrollstand, damit Vorher und Nachher gleich mitlaufen.
 */
(() => {
	if (window.__websiBridge) return;
	window.__websiBridge = true;
	if (window.parent === window) return;

	const parentWin = window.parent;
	const send = (msg) => parentWin.postMessage(msg, "*");
	const statusText = {
		offen: "Gesammelt",
		in_arbeit: "In Arbeit",
		vorschlag: "Vorschlag da",
		veroeffentlicht: "Live",
		verworfen: "Verworfen",
	};

	let sections = [];
	let preview = {};
	const clicked = new Set();
	let lastReady = "";
	let state = {};
	const bars = new Map();
	let pinFor = null;
	let mode = "edit";
	let compareSections = [];
	let collect = false;
	let silentScroll = false;

	const css = `
		:host { all: initial; }
		.bar { box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
			color: #1d2433; background: #f6f4ef; border-top: 1px solid #d9d4c7; border-bottom: 1px solid #d9d4c7;
			padding: 10px 16px; display: grid; gap: 8px; }
		.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
		.label { font-weight: 600; }
		.chip { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: #e6e1d4; }
		.chip.vorschlag { background: #1f4e79; color: #fff; }
		.chip.in_arbeit { background: #f1d9a6; }
		.chip.offen { background: #e6e1d4; }
		.chip.veroeffentlicht { background: #d4e8d4; }
		.row { display: flex; gap: 8px; align-items: flex-end; }
		textarea { flex: 1; min-height: 40px; max-height: 160px; resize: vertical; box-sizing: border-box;
			font: inherit; padding: 8px 10px; border: 1px solid #c9c2b1; border-radius: 8px; background: #fff; color: inherit; }
		textarea:focus { outline: 2px solid #1f4e79; outline-offset: 1px; }
		button { font: inherit; border-radius: 8px; padding: 8px 12px; cursor: pointer; border: 1px solid #1f4e79; }
		.send { background: #1f4e79; color: #fff; }
		.send:disabled { opacity: .45; cursor: default; }
		.pin { background: #fff; color: #1f4e79; }
		.pin[aria-pressed="true"] { background: #1f4e79; color: #fff; }
		ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
		li button { all: unset; cursor: pointer; display: flex; gap: 8px; align-items: baseline; width: 100%; font-size: 13px; }
		li button:hover .t, li button:focus-visible .t { text-decoration: underline; }
		.t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.hint { font-size: 12px; color: #5b6170; }
		@media (max-width: 560px) { .row { flex-wrap: wrap; } textarea { flex-basis: 100%; } .row button { flex: 1; } }
	`;

	function findElement(def) {
		const el = safeQuery(def.selector);
		if (!el) return null;
		// Mitlaufende Kopfzeilen haben keinen festen Platz für ein Feld darunter.
		const pos = getComputedStyle(el).position;
		return pos === "fixed" || pos === "sticky" ? null : el;
	}

	function makeBar(def) {
		const host = document.createElement("websi-bar");
		host.setAttribute("data-websi", def.id);
		host.style.cssText = "position:absolute;left:0;right:0;z-index:2147483000;display:block;";
		const root = host.attachShadow({ mode: "open" });
		root.innerHTML = `<style>${css}</style>
			<form class="bar" aria-label="Änderungswunsch zu ${escapeHtml(def.label)}">
				<div class="head"><span class="label">${escapeHtml(def.label)}</span><span class="chip" hidden></span><span class="hint" hidden></span></div>
				<ul></ul>
				<div class="row">
					<textarea rows="1" placeholder="Was soll sich an „${escapeHtml(def.label)}“ ändern?"></textarea>
					<button type="button" class="pin" aria-pressed="false" title="Stelle im Abschnitt markieren">Stelle</button>
					<button type="submit" class="send" disabled>${collect ? "Sammeln" : "Senden"}</button>
				</div>
			</form>`;
		const form = root.querySelector("form");
		const area = root.querySelector("textarea");
		const sendBtn = root.querySelector(".send");
		const pinBtn = root.querySelector(".pin");
		const hint = root.querySelector(".hint");
		const bar = { def, host, root, area, pin: null, el: null };

		area.addEventListener("input", () => {
			sendBtn.disabled = !area.value.trim();
			area.style.height = "auto";
			area.style.height = `${Math.min(160, area.scrollHeight)}px`;
		});
		area.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
		});
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const text = area.value.trim();
			if (!text) return;
			send({ type: "websi:submit", sectionId: def.id, text, pin: bar.pin, path: location.pathname + location.search });
			area.value = "";
			sendBtn.disabled = true;
			bar.pin = null;
			hint.hidden = true;
			removeMarker(def.id);
		});
		pinBtn.addEventListener("click", () => {
			const on = pinFor !== def.id;
			setPinMode(on ? def.id : null);
		});
		root.addEventListener("click", (e) => {
			const item = e.target.closest?.("[data-request]");
			if (item) send({ type: "websi:open", requestId: item.getAttribute("data-request") });
		});
		bar.setHint = (text) => {
			hint.textContent = text;
			hint.hidden = !text;
		};
		bar.setPinPressed = (on) => pinBtn.setAttribute("aria-pressed", String(on));
		bar.setCollect = (on) => {
			sendBtn.textContent = on ? "Sammeln" : "Senden";
		};
		return bar;
	}

	function setPinMode(sectionId) {
		pinFor = sectionId;
		for (const bar of bars.values()) bar.setPinPressed(bar.def.id === sectionId);
		document.documentElement.style.cursor = sectionId ? "crosshair" : "";
	}

	document.addEventListener(
		"click",
		(e) => {
			if (!pinFor) return;
			const bar = bars.get(pinFor);
			if (!bar?.el || e.composedPath().includes(bar.host)) return;
			if (!bar.el.contains(e.target)) return;
			e.preventDefault();
			e.stopPropagation();
			const r = bar.el.getBoundingClientRect();
			const x = ((e.clientX - r.left) / r.width) * 100;
			const y = ((e.clientY - r.top) / r.height) * 100;
			const hintText = (e.target.textContent || e.target.getAttribute?.("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);
			bar.pin = { x, y, hint: hintText || undefined };
			bar.setHint(`Stelle markiert${hintText ? `: „${hintText.slice(0, 40)}“` : ""}`);
			showMarker(bar, e.pageX, e.pageY);
			setPinMode(null);
			bar.area.focus();
		},
		true,
	);

	function showMarker(bar, pageX, pageY) {
		removeMarker(bar.def.id);
		const dot = document.createElement("websi-pin");
		dot.setAttribute("data-websi-pin", bar.def.id);
		dot.style.cssText = `position:absolute;left:${pageX - 9}px;top:${pageY - 9}px;width:18px;height:18px;border-radius:50%;background:#1f4e79;border:3px solid #fff;box-shadow:0 0 0 1px #1f4e79;z-index:2147483001;pointer-events:none;`;
		document.body.appendChild(dot);
	}

	function removeMarker(id) {
		for (const el of document.querySelectorAll(`[data-websi-pin="${id}"]`)) el.remove();
	}

	function renderState(bar) {
		const items = (state[bar.def.id] || []).slice(0, 4);
		const ul = bar.root.querySelector("ul");
		ul.innerHTML = items
			.map(
				(r) =>
					`<li><button type="button" data-request="${escapeHtml(r.id)}"><span class="chip ${escapeHtml(r.status)}">${statusText[r.status] || r.status}</span><span class="t">${escapeHtml(r.text)}</span></button></li>`,
			)
			.join("");
		const open = (state[bar.def.id] || []).filter((r) => r.status !== "veroeffentlicht" && r.status !== "verworfen");
		const chip = bar.root.querySelector(".head .chip");
		chip.hidden = open.length === 0;
		chip.textContent = `${open.length} offen`;
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	}

	function prepare() {
		for (const sel of preview.click || []) {
			if (clicked.has(sel)) continue;
			const el = safeQuery(sel);
			if (el) {
				clicked.add(sel);
				el.click();
			}
		}
	}

	function safeQuery(sel) {
		try {
			return document.querySelector(sel);
		} catch {
			return null;
		}
	}

	function applyHide() {
		const hide = (preview.hide || []).filter(Boolean);
		let style = document.getElementById("websi-hide");
		if (!hide.length) return style?.remove();
		if (!style) {
			style = document.createElement("style");
			style.id = "websi-hide";
			document.head.appendChild(style);
		}
		style.textContent = `${hide.join(",")}{display:none!important}`;
	}

	function reportReady(result) {
		const key = result.found.join(",");
		if (key === lastReady) return;
		lastReady = key;
		send({ type: "websi:ready", ...result, path: location.pathname + location.search, title: document.title });
	}

	function attach() {
		prepare();
		const found = [];
		const missing = [];
		for (const def of sections) {
			let bar = bars.get(def.id);
			const el = findElement(def);
			if (!el) {
				missing.push(def.id);
				if (bar) bar.host.style.display = "none";
				continue;
			}
			found.push(def.id);
			if (!bar) {
				bar = makeBar(def);
				bars.set(def.id, bar);
				renderState(bar);
			}
			if (!bar.host.isConnected) document.body.appendChild(bar.host);
			bar.host.style.display = "block";
			if (bar.el !== el) {
				if (bar.el) bar.el.style.marginBottom = bar.el.dataset.websiMargin || "";
				bar.el = el;
				el.dataset.websiMargin = el.style.marginBottom;
			}
		}
		layout();
		return { found, missing };
	}

	function layout() {
		for (const bar of bars.values()) {
			if (!bar.el || bar.host.style.display === "none") continue;
			const h = bar.host.offsetHeight || 0;
			bar.el.style.marginBottom = `${h}px`;
		}
		for (const bar of bars.values()) {
			if (!bar.el || bar.host.style.display === "none") continue;
			const r = bar.el.getBoundingClientRect();
			bar.host.style.top = `${r.bottom + window.scrollY}px`;
		}
	}

	let raf = 0;
	const schedule = () => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(() => {
			if (mode === "compare") prepare();
			else if (sections.length) reportReady(attach());
		});
	};

	function reportVisible() {
		let best = null;
		let bestTop = Infinity;
		for (const bar of bars.values()) {
			if (!bar.el) continue;
			const r = bar.el.getBoundingClientRect();
			if (r.bottom > window.innerHeight * 0.3 && r.top < bestTop) {
				best = bar.def.id;
				bestTop = r.top;
			}
		}
		if (best) send({ type: "websi:visible", sectionId: best });
	}

	window.addEventListener("message", (e) => {
		if (e.source !== parentWin) return;
		const msg = e.data;
		if (!msg || typeof msg.type !== "string") return;
		if (msg.type === "websi:config") {
			preview = msg.preview || {};
			mode = msg.mode === "compare" ? "compare" : "edit";
			collect = Boolean(msg.collect);
			applyHide();
			if (mode === "compare") {
				// Nur ansehen: Abschnitte merken (für scrollTo), aber keine Felder.
				sections = [];
				compareSections = Array.isArray(msg.sections) ? msg.sections : [];
				prepare();
				return;
			}
			sections = Array.isArray(msg.sections) ? msg.sections : [];
			lastReady = null;
			reportReady(attach());
		} else if (msg.type === "websi:mode") {
			collect = Boolean(msg.collect);
			for (const bar of bars.values()) bar.setCollect(collect);
		} else if (msg.type === "websi:scrollY") {
			silentScroll = true;
			window.scrollTo({ top: msg.y, behavior: "instant" });
		} else if (msg.type === "websi:state") {
			state = msg.bySection || {};
			for (const bar of bars.values()) renderState(bar);
			layout();
		} else if (msg.type === "websi:scrollTo") {
			const bar = bars.get(msg.sectionId);
			const def = compareSections.find((d) => d.id === msg.sectionId);
			const el = bar?.el || (def && safeQuery(def.selector));
			if (el) el.scrollIntoView({ behavior: msg.smooth === false ? "instant" : "smooth", block: "start" });
		}
	});

	new ResizeObserver(() => layout()).observe(document.documentElement);
	new MutationObserver((records) => {
		if (records.every((r) => r.target.nodeName === "WEBSI-BAR" || [...r.addedNodes].every((n) => n.nodeName === "WEBSI-BAR" || n.nodeName === "WEBSI-PIN"))) return;
		schedule();
	}).observe(document.body, { childList: true, subtree: true });
	window.addEventListener("resize", layout);
	let scrollTimer = 0;
	let scrollRaf = 0;
	window.addEventListener(
		"scroll",
		() => {
			if (mode === "compare") {
				if (silentScroll) {
					silentScroll = false;
					return;
				}
				cancelAnimationFrame(scrollRaf);
				scrollRaf = requestAnimationFrame(() => send({ type: "websi:scroll", y: window.scrollY }));
				return;
			}
			clearTimeout(scrollTimer);
			scrollTimer = setTimeout(reportVisible, 120);
		},
		{ passive: true },
	);
	setInterval(layout, 1500);

	send({ type: "websi:hello", path: location.pathname + location.search });
})();
