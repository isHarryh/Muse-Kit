// Copyright (c) 2026, Harry Huang
// Generic multi-track timeline widget for MediaSync.
'use strict';

const Timeline = (() => {
    const DEFAULTS = {
        pxPerSecond: 60,
        minPxPerSecond: 10,
        maxPxPerSecond: 400,
        trackHeight: 34,
        rulerHeight: 24,
        labelWidth: 76,
        showGrid: true,
        showRuler: true,
        playheadMode: 'centered',
        interactive: true,
        labelFormatter: null,
    };

    const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
    const CLICK_THRESHOLD_PX = 3;
    const SCALE_DRAG_PX_PER_OCTAVE = 180;

    function assign(target, source) {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        }
        return target;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function formatTime(seconds, step) {
        const sign = seconds < 0 ? '-' : '';
        const abs = Math.abs(seconds);
        const h = Math.floor(abs / 3600);
        const m = Math.floor((abs % 3600) / 60);
        const s = Math.floor(abs % 60);
        const ms = Math.round((abs % 1) * 1000);
        const pad2 = value => value < 10 ? '0' + value : '' + value;
        const pad3 = value => value < 10 ? '00' + value : value < 100 ? '0' + value : '' + value;
        const showFraction = step < 1;

        if (h > 0) {
            const base = sign + h + ':' + pad2(m) + ':' + pad2(s);
            return showFraction ? base + '.' + pad3(ms) : base;
        }

        const base = sign + m + ':' + pad2(s);
        return showFraction ? base + '.' + pad3(ms) : base;
    }

    function chooseTickStep(pxPerSecond) {
        const targetPx = 78;
        for (const step of TICK_STEPS) {
            if (step * pxPerSecond >= targetPx) return step;
        }
        return TICK_STEPS[TICK_STEPS.length - 1];
    }

    function resizeCanvas(canvas, cssWidth, cssHeight) {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(cssWidth * ratio));
        const height = Math.max(1, Math.floor(cssHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return ctx;
    }

    function createEl(tag, className) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        return el;
    }

    function normalizeTrack(track, index, defaults) {
        return {
            id: String(track.id),
            label: track.label || track.id || '',
            order: track.order !== undefined ? track.order : index,
            height: track.height || defaults.trackHeight,
            visible: track.visible !== false,
            locked: !!track.locked,
            kind: track.kind || 'generic',
            items: Array.isArray(track.items) ? track.items.slice() : [],
            meta: track.meta || {},
            className: track.className || '',
        };
    }

    function normalizeItem(item) {
        return {
            id: String(item.id),
            type: item.type || 'strip',
            start: Number(item.start) || 0,
            end: item.end !== undefined ? Number(item.end) : Number(item.start) || 0,
            label: item.label || '',
            className: item.className || '',
            color: item.color || '',
            draggable: !!item.draggable,
            selectable: item.selectable !== false,
            meta: item.meta || {},
        };
    }

    function TimelineInstance(rootEl, options) {
        this.rootEl = rootEl;
        this.options = assign(assign({}, DEFAULTS), options || {});
        this.rangeStart = 0;
        this.rangeEnd = 10;
        this.currentTime = 0;
        this.pxPerSecond = clamp(this.options.pxPerSecond, this.options.minPxPerSecond, this.options.maxPxPerSecond);
        this.tracks = [];
        this.handlers = {};
        this.renderQueued = false;
        this.destroyed = false;
        this.scrubbing = false;
        this.scaling = false;
        this.scrubMoved = false;
        this.lastPointerItem = null;
        this.lastPointerTrack = null;
        this.pointerStartClientX = 0;
        this.pointerStartTime = 0;
        this.pointerStartScale = this.pxPerSecond;
        this.pointerTargetEl = null;
        this.latestScrubTime = 0;
        this._buildDom();
        this._bindEvents();
        this.render();
    }

    TimelineInstance.prototype._buildDom = function () {
        this.rootEl.innerHTML = '';
        this.rootEl.classList.add('timeline-root');

        this.rulerCanvas = createEl('canvas', 'timeline-ruler-canvas');
        this.bodyEl = createEl('div', 'timeline-body');
        this.labelsEl = createEl('div', 'timeline-labels');
        this.viewportEl = createEl('div', 'timeline-viewport');
        this.gridCanvas = createEl('canvas', 'timeline-grid-canvas');
        this.tracksEl = createEl('div', 'timeline-tracks');
        this.playheadEl = createEl('div', 'timeline-playhead');

        this.viewportEl.appendChild(this.gridCanvas);
        this.viewportEl.appendChild(this.tracksEl);
        this.viewportEl.appendChild(this.playheadEl);
        this.bodyEl.appendChild(this.labelsEl);
        this.bodyEl.appendChild(this.viewportEl);
        this.rootEl.appendChild(this.rulerCanvas);
        this.rootEl.appendChild(this.bodyEl);
    };

    TimelineInstance.prototype._bindEvents = function () {
        const self = this;
        this._onPointerDown = function (event) { self._handlePointerDown(event); };
        this._onPointerMove = function (event) { self._handlePointerMove(event); };
        this._onPointerUp = function (event) { self._handlePointerUp(event); };
        this._onResize = function () { self.resize(); };

        if (this.options.interactive) {
            this.rulerCanvas.addEventListener('pointerdown', this._onPointerDown);
            this.rulerCanvas.addEventListener('pointermove', this._onPointerMove);
            this.rulerCanvas.addEventListener('pointerup', this._onPointerUp);
            this.rulerCanvas.addEventListener('pointercancel', this._onPointerUp);
            this.viewportEl.addEventListener('pointerdown', this._onPointerDown);
            this.viewportEl.addEventListener('pointermove', this._onPointerMove);
            this.viewportEl.addEventListener('pointerup', this._onPointerUp);
            this.viewportEl.addEventListener('pointercancel', this._onPointerUp);
        }
        window.addEventListener('resize', this._onResize);
    };

    TimelineInstance.prototype._emit = function (eventName, payload) {
        const list = this.handlers[eventName];
        if (!list) return;
        for (const handler of list.slice()) handler(payload || {});
    };

    TimelineInstance.prototype.on = function (eventName, handler) {
        if (!this.handlers[eventName]) this.handlers[eventName] = [];
        this.handlers[eventName].push(handler);
        return this;
    };

    TimelineInstance.prototype.off = function (eventName, handler) {
        const list = this.handlers[eventName];
        if (!list) return this;
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
        return this;
    };

    TimelineInstance.prototype._contentWidth = function () {
        return Math.max(1, (this.rangeEnd - this.rangeStart) * this.pxPerSecond);
    };

    TimelineInstance.prototype._bodyHeight = function () {
        return this.tracks.reduce((sum, track) => sum + (track.visible ? track.height : 0), 0);
    };

    TimelineInstance.prototype._viewportWidth = function () {
        return Math.max(1, this.rootEl.clientWidth - this.options.labelWidth);
    };

    TimelineInstance.prototype._translateX = function () {
        if (this.options.playheadMode !== 'centered') return 0;
        return this._viewportWidth() / 2 - this.timeToPx(this.currentTime);
    };

    TimelineInstance.prototype.timeToPx = function (timeSec) {
        return (timeSec - this.rangeStart) * this.pxPerSecond;
    };

    TimelineInstance.prototype.pxToTime = function (px) {
        return this.rangeStart + px / this.pxPerSecond;
    };

    TimelineInstance.prototype._isRulerEvent = function (event) {
        return event.currentTarget === this.rulerCanvas;
    };

    TimelineInstance.prototype._contentClientXToTime = function (clientX) {
        const rect = this.viewportEl.getBoundingClientRect();
        const contentX = clientX - rect.left - this._translateX();
        return this.pxToTime(contentX);
    };

    TimelineInstance.prototype._clientXToTime = function (clientX) {
        return this._contentClientXToTime(clientX);
    };

    TimelineInstance.prototype._clientYToTrack = function (clientY) {
        const rect = this.viewportEl.getBoundingClientRect();
        let y = clientY - rect.top;
        for (const track of this.tracks) {
            if (!track.visible) continue;
            if (y >= 0 && y <= track.height) return track;
            y -= track.height;
        }
        return null;
    };

    TimelineInstance.prototype.clampTime = function (timeSec) {
        return clamp(timeSec, this.rangeStart, this.rangeEnd);
    };

    TimelineInstance.prototype.getVisibleRange = function () {
        const width = this._viewportWidth();
        const left = this.options.playheadMode === 'centered'
            ? this.currentTime - width / 2 / this.pxPerSecond
            : this.rangeStart;
        return { start: left, end: left + width / this.pxPerSecond };
    };

    TimelineInstance.prototype.setRange = function (startSec, endSec) {
        const start = Number(startSec);
        const end = Number(endSec);
        if (!isFinite(start) || !isFinite(end) || end <= start) return this;
        this.rangeStart = start;
        this.rangeEnd = end;
        this.currentTime = this.clampTime(this.currentTime);
        this._emit('rangechange', { start: this.rangeStart, end: this.rangeEnd });
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.setCurrentTime = function (timeSec, meta) {
        const next = this.clampTime(Number(timeSec) || 0);
        if (Math.abs(next - this.currentTime) < 0.0001) return this;
        this.currentTime = next;
        this._applyTransforms();
        this._drawCanvases();
        this._emit('timechange', assign({ time: this.currentTime }, meta || {}));
        return this;
    };

    TimelineInstance.prototype.getCurrentTime = function () {
        return this.currentTime;
    };

    TimelineInstance.prototype.setScale = function (pxPerSecond) {
        const next = clamp(Number(pxPerSecond) || this.pxPerSecond, this.options.minPxPerSecond, this.options.maxPxPerSecond);
        if (next === this.pxPerSecond) return this;
        this.pxPerSecond = next;
        this._emit('scalechange', { pxPerSecond: next });
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.getScale = function () {
        return this.pxPerSecond;
    };

    TimelineInstance.prototype.setTracks = function (trackDefs) {
        const defs = Array.isArray(trackDefs) ? trackDefs : [];
        this.tracks = defs.map((track, index) => normalizeTrack(track, index, this.options))
            .sort((a, b) => a.order - b.order);
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.upsertTrack = function (trackDef) {
        const id = String(trackDef.id);
        const index = this.tracks.findIndex(track => track.id === id);
        const normalized = normalizeTrack(trackDef, index >= 0 ? this.tracks[index].order : this.tracks.length, this.options);
        if (index >= 0) this.tracks[index] = normalized;
        else this.tracks.push(normalized);
        this.tracks.sort((a, b) => a.order - b.order);
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.removeTrack = function (trackId) {
        this.tracks = this.tracks.filter(track => track.id !== trackId);
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.setTrackItems = function (trackId, items) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.items = Array.isArray(items) ? items.slice() : [];
            this.requestRender();
        }
        return this;
    };

    TimelineInstance.prototype.clearTrack = function (trackId) {
        return this.setTrackItems(trackId, []);
    };

    TimelineInstance.prototype.requestRender = function () {
        if (this.renderQueued || this.destroyed) return this;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            if (!this.destroyed) this.render();
        });
        return this;
    };

    TimelineInstance.prototype.render = function () {
        const bodyHeight = Math.max(1, this._bodyHeight());
        const contentWidth = this._contentWidth();

        this.rootEl.style.setProperty('--timeline-label-width', this.options.labelWidth + 'px');
        this.rootEl.style.setProperty('--timeline-ruler-height', this.options.rulerHeight + 'px');
        this.bodyEl.style.height = bodyHeight + 'px';
        this.labelsEl.style.width = this.options.labelWidth + 'px';
        this.tracksEl.style.width = contentWidth + 'px';
        this.tracksEl.style.height = bodyHeight + 'px';

        this._renderTracks(contentWidth);
        this._applyTransforms();
        this._drawCanvases();
        return this;
    };

    TimelineInstance.prototype._renderTracks = function (contentWidth) {
        this.labelsEl.innerHTML = '';
        this.tracksEl.innerHTML = '';

        for (const track of this.tracks) {
            if (!track.visible) continue;

            const labelEl = createEl('div', 'timeline-track-label');
            labelEl.style.height = track.height + 'px';
            labelEl.textContent = track.label;
            this.labelsEl.appendChild(labelEl);

            const trackEl = createEl('div', 'timeline-track timeline-track-' + track.kind + (track.className ? ' ' + track.className : ''));
            trackEl.style.height = track.height + 'px';
            trackEl.style.width = contentWidth + 'px';
            trackEl.dataset.trackId = track.id;

            for (const rawItem of track.items) {
                const item = normalizeItem(rawItem);
                const itemEl = createEl('div', 'timeline-item ' + item.className);
                const left = this.timeToPx(item.start);
                const right = this.timeToPx(item.end);
                itemEl.style.left = Math.round(left) + 'px';
                itemEl.style.width = Math.max(2, Math.round(right - left)) + 'px';
                itemEl.dataset.left = Math.round(left);
                itemEl.dataset.width = Math.max(2, Math.round(right - left));
                if (item.color) itemEl.style.background = item.color;
                const labelEl = createEl('span', 'timeline-item-label');
                labelEl.textContent = item.label;
                itemEl.appendChild(labelEl);
                itemEl.title = item.label;
                itemEl.dataset.trackId = track.id;
                itemEl.dataset.itemId = item.id;
                trackEl.appendChild(itemEl);
            }

            this.tracksEl.appendChild(trackEl);
        }
    };

    TimelineInstance.prototype._applyTransforms = function () {
        const translateX = this._translateX();
        this.tracksEl.style.transform = 'translateX(' + translateX + 'px)';
        if (this.options.playheadMode === 'centered') {
            this.playheadEl.style.left = '50%';
        } else {
            this.playheadEl.style.left = this.timeToPx(this.currentTime) + 'px';
        }
        this._positionItemLabels();
    };

    TimelineInstance.prototype._positionItemLabels = function () {
        const viewportWidth = this._viewportWidth();
        const translateX = this._translateX();
        const itemEls = this.tracksEl.querySelectorAll('.timeline-item');

        for (const itemEl of itemEls) {
            const labelEl = itemEl.querySelector('.timeline-item-label');
            if (!labelEl) continue;

            const itemLeft = Number(itemEl.dataset.left) || 0;
            const itemWidth = Number(itemEl.dataset.width) || 0;
            const screenLeft = itemLeft + translateX;
            const screenRight = screenLeft + itemWidth;
            const visibleLeft = clamp(screenLeft, 0, viewportWidth);
            const visibleRight = clamp(screenRight, 0, viewportWidth);
            const visibleWidth = visibleRight - visibleLeft;

            if (visibleWidth <= 8) {
                labelEl.style.display = 'none';
                continue;
            }

            const centerInItem = (visibleLeft + visibleRight) / 2 - screenLeft;
            labelEl.style.display = 'flex';
            labelEl.style.left = clamp(centerInItem, 0, itemWidth) + 'px';
            labelEl.style.maxWidth = Math.max(0, Math.min(itemWidth - 8, visibleWidth - 8)) + 'px';
        }
    };

    TimelineInstance.prototype._drawCanvases = function () {
        const rootWidth = Math.max(1, this.rootEl.clientWidth);
        const viewportWidth = this._viewportWidth();
        const bodyHeight = Math.max(1, this._bodyHeight());
        const labelWidth = this.options.labelWidth;

        const rulerCtx = resizeCanvas(this.rulerCanvas, rootWidth, this.options.rulerHeight);
        const gridCtx = resizeCanvas(this.gridCanvas, viewportWidth, bodyHeight);

        rulerCtx.clearRect(0, 0, rootWidth, this.options.rulerHeight);
        gridCtx.clearRect(0, 0, viewportWidth, bodyHeight);

        rulerCtx.fillStyle = '#151515';
        rulerCtx.fillRect(0, 0, rootWidth, this.options.rulerHeight);
        rulerCtx.fillStyle = '#222';
        rulerCtx.fillRect(0, 0, labelWidth, this.options.rulerHeight);
        rulerCtx.strokeStyle = '#333';
        rulerCtx.beginPath();
        rulerCtx.moveTo(labelWidth + 0.5, 0);
        rulerCtx.lineTo(labelWidth + 0.5, this.options.rulerHeight);
        rulerCtx.stroke();

        const visible = this.getVisibleRange();
        const step = chooseTickStep(this.pxPerSecond);
        const minorStep = step / 5;
        const translateX = this._translateX();
        const formatter = this.options.labelFormatter || formatTime;
        const startTick = Math.floor(visible.start / minorStep) * minorStep;
        const endTick = visible.end + minorStep;

        gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        rulerCtx.font = '11px Consolas, "Courier New", monospace';
        rulerCtx.textBaseline = 'top';

        for (let t = startTick; t <= endTick; t += minorStep) {
            const isMajor = Math.abs(t / step - Math.round(t / step)) < 0.001;
            const x = labelWidth + this.timeToPx(t) + translateX;
            const gridX = x - labelWidth;
            if (gridX < -1 || gridX > viewportWidth + 1) continue;

            if (isMajor) {
                rulerCtx.strokeStyle = '#555';
                rulerCtx.fillStyle = '#aaa';
                rulerCtx.beginPath();
                rulerCtx.moveTo(x + 0.5, this.options.rulerHeight - 11);
                rulerCtx.lineTo(x + 0.5, this.options.rulerHeight);
                rulerCtx.stroke();
                rulerCtx.fillText(formatter(t, step), x + 4, 4);
            } else if (minorStep * this.pxPerSecond >= 8) {
                rulerCtx.strokeStyle = '#3a3a3a';
                rulerCtx.beginPath();
                rulerCtx.moveTo(x + 0.5, this.options.rulerHeight - 5);
                rulerCtx.lineTo(x + 0.5, this.options.rulerHeight);
                rulerCtx.stroke();
            }

            if (this.options.showGrid && isMajor) {
                gridCtx.beginPath();
                gridCtx.moveTo(gridX + 0.5, 0);
                gridCtx.lineTo(gridX + 0.5, bodyHeight);
                gridCtx.stroke();
            }
        }
    };

    TimelineInstance.prototype._handlePointerDown = function (event) {
        if (event.button !== undefined && event.button !== 0) return;

        this.scaling = this._isRulerEvent(event);
        this.scrubbing = !this.scaling;
        this.scrubMoved = false;
        this.pointerStartClientX = event.clientX;
        this.pointerStartTime = this.currentTime;
        this.pointerStartScale = this.pxPerSecond;
        this.pointerTargetEl = event.currentTarget;
        this.lastPointerItem = event.target.closest ? event.target.closest('.timeline-item') : null;
        this.lastPointerTrack = this.scaling ? null : this._clientYToTrack(event.clientY);
        this.pointerTargetEl.setPointerCapture?.(event.pointerId);

        if (this.scaling) {
            this.rootEl.classList.add('scaling');
            this._emit('scalestart', { pxPerSecond: this.pxPerSecond, source: 'user', originalEvent: event });
        } else {
            this.rootEl.classList.add('scrubbing');
            this.latestScrubTime = this.currentTime;
            this._emit('scrubstart', { time: this.currentTime, source: 'user', originalEvent: event });
        }

        event.preventDefault();
    };

    TimelineInstance.prototype._handlePointerMove = function (event) {
        if (!this.scrubbing && !this.scaling) return;
        const deltaX = event.clientX - this.pointerStartClientX;
        this.scrubMoved = this.scrubMoved || Math.abs(deltaX) > CLICK_THRESHOLD_PX;

        if (this.scaling) {
            const factor = Math.pow(2, deltaX / SCALE_DRAG_PX_PER_OCTAVE);
            const nextScale = this.pointerStartScale * factor;
            this.setScale(nextScale);
            return;
        }

        const time = this.clampTime(this.pointerStartTime - deltaX / this.pxPerSecond);
        this.latestScrubTime = time;
        this.setCurrentTime(time, { source: 'user' });
        this._emit('scrubmove', { time, source: 'user', originalEvent: event });
    };

    TimelineInstance.prototype._handlePointerUp = function (event) {
        if (!this.scrubbing && !this.scaling) return;
        const wasScaling = this.scaling;
        const wasScrubbing = this.scrubbing;
        this.scrubbing = false;
        this.scaling = false;
        this.rootEl.classList.remove('scrubbing');
        this.rootEl.classList.remove('scaling');
        this.pointerTargetEl?.releasePointerCapture?.(event.pointerId);

        if (wasScaling) {
            this._emit('scaleend', { pxPerSecond: this.pxPerSecond, source: 'user', originalEvent: event });
            return;
        }

        const time = this.scrubMoved ? this.latestScrubTime : this.clampTime(this._contentClientXToTime(event.clientX));
        this.setCurrentTime(time, { source: 'user' });

        const itemEl = this.lastPointerItem;
        const track = this.lastPointerTrack;
        if (wasScrubbing && !this.scrubMoved && itemEl) {
            this._emit('itemclick', {
                time,
                trackId: itemEl.dataset.trackId,
                itemId: itemEl.dataset.itemId,
                source: 'user',
                originalEvent: event,
            });
        } else if (wasScrubbing && !this.scrubMoved && track) {
            this._emit('trackclick', {
                time,
                trackId: track.id,
                source: 'user',
                originalEvent: event,
            });
        }

        this._emit('scrubend', { time, source: 'user', originalEvent: event });
        this._emit('seekrequest', { time, source: 'user', originalEvent: event });
    };

    TimelineInstance.prototype.resize = function () {
        this.requestRender();
        return this;
    };

    TimelineInstance.prototype.destroy = function () {
        this.destroyed = true;
        window.removeEventListener('resize', this._onResize);
        this.viewportEl.removeEventListener('pointerdown', this._onPointerDown);
        this.viewportEl.removeEventListener('pointermove', this._onPointerMove);
        this.viewportEl.removeEventListener('pointerup', this._onPointerUp);
        this.viewportEl.removeEventListener('pointercancel', this._onPointerUp);
        this.rootEl.innerHTML = '';
        this.handlers = {};
    };

    function create(rootEl, options) {
        if (!rootEl) throw new Error('Timeline.create requires a root element');
        return new TimelineInstance(rootEl, options || {});
    }

    return { create };
})();
