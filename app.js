const data = window.ACLED_ATTACKS_DATA || { meta: {}, records: [] };

const COLORS = {
  Iran: "#d1495b",
  "Israel/US": "#2a9d8f",
};

const MIDDLE_EAST_BOUNDS = [
  [10, 24],
  [42, 66],
];

const IRGC_RAW = [
  { date: "2026-02-28", missiles: 350, drones: 800 },
  { date: "2026-03-01", missiles: 175, drones: 400 },
  { date: "2026-03-02", missiles: 120, drones: 500 },
  { date: "2026-03-03", missiles: 110, drones: 280 },
  { date: "2026-03-04", missiles: 50, drones: 230 },
  { date: "2026-03-05", missiles: 35, drones: 100 },
  { date: "2026-03-06", missiles: 35, drones: 135 },
  { date: "2026-03-07", missiles: 30, drones: 165 },
  { date: "2026-03-08", missiles: 55, drones: 180 },
  { date: "2026-03-09", missiles: 25, drones: 55 },
  { date: "2026-03-10", missiles: 45, drones: 45 },
  { date: "2026-03-11", missiles: 30, drones: 40 },
  { date: "2026-03-12", missiles: 25, drones: 65 },
  { date: "2026-03-13", missiles: 30, drones: 110 },
  { date: "2026-03-14", missiles: 25, drones: 75 },
  { date: "2026-03-15", missiles: 20, drones: 50 },
  { date: "2026-03-16", missiles: 35, drones: 95 },
  { date: "2026-03-17", missiles: 30, drones: 95 },
  { date: "2026-03-18", missiles: 50, drones: 90 },
  { date: "2026-03-19", missiles: 25, drones: 45 },
];

const state = {
  records: data.records || [],
  periods: [],
  attackMapPeriod: "all",
  fatalityMapPeriod: "all",
  maps: {
    attack: null,
    fatality: null,
  },
  layers: {
    attack: null,
    fatality: null,
  },
  irgcSeries: {
    dronesEMA: { label: "Drones (2-day EMA)", color: "#0B5ED7", visible: true },
    missilesEMA: { label: "Missiles (2-day EMA)", color: "#E03C31", visible: true },
  },
};

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function byDate(a, b) {
  return String(a).localeCompare(String(b));
}

function parseDate(dateIso) {
  return new Date(`${dateIso}T00:00:00Z`);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStart(dateIso) {
  const date = parseDate(dateIso);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return toIsoDate(date);
}

function addDays(dateIso, days) {
  const date = parseDate(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function ema(values, span = 2) {
  const alpha = 2 / (span + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

function buildPeriods(rows) {
  const weekStarts = unique(rows.map((row) => getWeekStart(row.date_iso))).sort(byDate);
  return [
    { value: "all", label: "All-time" },
    ...weekStarts.map((weekStart, index) => ({
      value: weekStart,
      label: `Week ${index + 1}`,
      detail: `${weekStart} to ${addDays(weekStart, 6)}`,
    })),
  ];
}

function withCoordinates(rows) {
  return rows.filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
}

function plottedRows() {
  return state.records.filter((row) => row.side === "Iran" || row.side === "Israel/US");
}

function filterByPeriod(rows, periodValue) {
  if (periodValue === "all") {
    return rows;
  }
  return rows.filter((row) => getWeekStart(row.date_iso) === periodValue);
}

function getPeriodLabel(periodValue) {
  const match = state.periods.find((period) => period.value === periodValue);
  return match ? match.label : periodValue;
}

function getPeriodDetail(periodValue) {
  const match = state.periods.find((period) => period.value === periodValue);
  return match ? (match.detail || match.label) : periodValue;
}

function initMap(kind, elementId) {
  if (typeof window.L === "undefined") {
    return null;
  }

  if (state.maps[kind]) {
    return state.maps[kind];
  }

  const map = L.map(elementId, {
    zoomControl: true,
    maxBounds: MIDDLE_EAST_BOUNDS,
    maxBoundsViscosity: 1.0,
    worldCopyJump: false,
  });

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18,
    attribution: "Tiles &copy; Esri",
  }).addTo(map);

  map.fitBounds(MIDDLE_EAST_BOUNDS);
  state.maps[kind] = map;
  return map;
}

function clearLayer(kind) {
  if (state.layers[kind]) {
    state.layers[kind].clearLayers();
  }
}

function drawMap(kind, rows, markerFactory) {
  const map = initMap(kind, kind === "attack" ? "dailyMap" : "fatalityMap");
  if (!map) {
    const target = document.getElementById(kind === "attack" ? "dailyMap" : "fatalityMap");
    target.innerHTML = `<div class="empty">Map tiles did not load. The data is available, but Leaflet/basemap resources are unavailable in this view.</div>`;
    return;
  }
  clearLayer(kind);
  const layer = L.layerGroup(rows.map(markerFactory)).addTo(map);
  state.layers[kind] = layer;
  map.fitBounds(MIDDLE_EAST_BOUNDS);
  window.setTimeout(() => map.invalidateSize(), 0);
}

function buildHeroStats() {
  const rows = plottedRows();
  const totalFatalities = rows.reduce((sum, row) => sum + Number(row.fatalities || 0), 0);
  const dates = unique(state.records.map((row) => row.date_iso)).sort(byDate);
  const countries = unique(state.records.map((row) => row.country)).length;
  const iranCount = rows.filter((row) => row.side === "Iran").length;
  const israelUsCount = rows.filter((row) => row.side === "Israel/US").length;

  document.getElementById("heroStats").innerHTML = `
    <div class="hero-grid">
      <div class="stat">
        <p>Total attacks</p>
        <h3>${formatNumber(state.records.length)}</h3>
      </div>
      <div class="stat">
        <p>Date window</p>
        <h3>${escapeHtml(dates[0])} to ${escapeHtml(dates[dates.length - 1])}</h3>
      </div>
      <div class="stat">
        <p>Iran attacks</p>
        <h3>${formatNumber(iranCount)}</h3>
      </div>
      <div class="stat">
        <p>US-Israel-allies attacks</p>
        <h3>${formatNumber(israelUsCount)}</h3>
      </div>
      <div class="stat">
        <p>Fatalities</p>
        <h3>${formatNumber(totalFatalities)}</h3>
      </div>
      <div class="stat">
        <p>Countries involved</p>
        <h3>${formatNumber(countries)}</h3>
      </div>
    </div>
  `;
}

function setupSelectors() {
  state.periods = buildPeriods(state.records);
  const options = state.periods
    .map((period) => `<option value="${period.value}">${period.label}</option>`)
    .join("");

  const attackSelect = document.getElementById("attackMapPeriod");
  const fatalitySelect = document.getElementById("fatalityMapPeriod");

  attackSelect.innerHTML = options;
  fatalitySelect.innerHTML = options;
  attackSelect.value = "all";
  fatalitySelect.value = "all";

  attackSelect.addEventListener("change", () => {
    state.attackMapPeriod = attackSelect.value;
    renderAttackMap();
  });

  fatalitySelect.addEventListener("change", () => {
    state.fatalityMapPeriod = fatalitySelect.value;
    renderFatalityMap();
  });
}

function renderTrend() {
  const container = document.getElementById("attackTrend");
  const grouped = unique(plottedRows().map((row) => row.date_iso))
    .sort(byDate)
    .map((dateIso) => {
      const rows = plottedRows().filter((row) => row.date_iso === dateIso);
      return {
        label: dateIso,
        shortLabel: dateIso,
        Iran: rows.filter((row) => row.side === "Iran").length,
        "Israel/US": rows.filter((row) => row.side === "Israel/US").length,
      };
    });

  const width = Math.max(880, grouped.length * 44);
  const height = 320;
  const chartLeft = 60;
  const chartTop = 24;
  const chartHeight = 220;
  const maxValue = Math.max(...grouped.flatMap((row) => [row.Iran, row["Israel/US"]]), 1);

  function xFor(index) {
    if (grouped.length === 1) {
      return chartLeft + width / 2;
    }
    return chartLeft + (index / (grouped.length - 1)) * (width - 90);
  }

  function yFor(value) {
    return chartTop + chartHeight - (value / maxValue) * chartHeight;
  }

  function pathFor(side) {
    return grouped
      .map((row, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(row[side])}`)
      .join(" ");
  }

  const ticks = [0, Math.ceil(maxValue / 2), maxValue]
    .map((tick) => {
      const y = yFor(tick);
      return `
        <line x1="${chartLeft}" x2="${width}" y1="${y}" y2="${y}" class="grid-line"></line>
        <text x="${chartLeft - 10}" y="${y + 4}" text-anchor="end" class="axis-label">${tick}</text>
      `;
    })
    .join("");

  const points = ["Iran", "Israel/US"]
    .map((side) =>
      grouped
        .map((row, index) => {
          const x = xFor(index);
          const y = yFor(row[side]);
          return `
            <circle cx="${x}" cy="${y}" r="4.5" fill="${COLORS[side]}">
              <title>${escapeHtml(row.label)} | ${escapeHtml(side)} | ${row[side]} attacks</title>
            </circle>
          `;
        })
        .join("")
    )
    .join("");

  const labels = grouped
    .map(
      (row, index) => {
        if (index % 2 !== 0 && index !== grouped.length - 1) {
          return "";
        }
        return `<text x="${xFor(index)}" y="${chartTop + chartHeight + 22}" text-anchor="middle" class="axis-label small">${row.shortLabel.slice(5)}</text>`;
      }
    )
    .join("");

  const chips = state.periods
    .filter((period) => period.value !== "all")
    .map(
      (period) => {
        const rows = filterByPeriod(plottedRows(), period.value);
        const iran = rows.filter((row) => row.side === "Iran").length;
        const israelUs = rows.filter((row) => row.side === "Israel/US").length;
        return `<div class="chip">${escapeHtml(period.label)}: <strong>${formatNumber(iran)}</strong> Iran, <strong>${formatNumber(
          israelUs
        )}</strong> US-Israel <small>${escapeHtml(period.detail)}</small></div>`
      }
    )
    .join("");

  container.innerHTML = `
    <div class="summary-strip compact">${chips}</div>
    <div class="scroll-x">
      <svg viewBox="0 0 ${width + 30} ${height}" class="svg-chart">
        ${ticks}
        <line x1="${chartLeft}" x2="${width}" y1="${chartTop + chartHeight}" y2="${chartTop + chartHeight}" class="axis-line"></line>
        <path d="${pathFor("Iran")}" fill="none" stroke="${COLORS.Iran}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
        <path d="${pathFor("Israel/US")}" fill="none" stroke="${COLORS["Israel/US"]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></path>
        ${points}
        ${labels}
      </svg>
    </div>
  `;
}

function renderAttackMap() {
  const summary = document.getElementById("dailyMapSummary");
  const rows = withCoordinates(filterByPeriod(plottedRows(), state.attackMapPeriod));
  const iranCount = rows.filter((row) => row.side === "Iran").length;
  const israelUsCount = rows.filter((row) => row.side === "Israel/US").length;
  const countries = unique(rows.map((row) => row.country)).length;

  summary.innerHTML = `
    <div class="chip"><strong>${escapeHtml(getPeriodLabel(state.attackMapPeriod))}</strong></div>
    <div class="chip">${escapeHtml(getPeriodDetail(state.attackMapPeriod))}</div>
    <div class="chip">Iran attacks: <strong>${formatNumber(iranCount)}</strong></div>
    <div class="chip">US-Israel attacks: <strong>${formatNumber(israelUsCount)}</strong></div>
    <div class="chip">Countries hit: <strong>${formatNumber(countries)}</strong></div>
  `;

  drawMap("attack", rows, (row) =>
    L.circleMarker([row.latitude, row.longitude], {
      radius: 6,
      color: "#08111d",
      weight: 1,
      fillColor: COLORS[row.side],
      fillOpacity: 0.82,
    }).bindPopup(`
      <strong>${escapeHtml(row.location)}</strong><br>
      ${escapeHtml(row.admin1)}, ${escapeHtml(row.country)}<br>
      ${escapeHtml(row.date_iso)}<br>
      ${escapeHtml(row.side)}<br>
      ${escapeHtml(row.sub_event_type)}
    `)
  );
}

function renderFatalityMap() {
  const summary = document.getElementById("fatalityMapSummary");
  const rows = withCoordinates(filterByPeriod(plottedRows(), state.fatalityMapPeriod).filter((row) => Number(row.fatalities) > 0));
  const grouped = {};

  rows.forEach((row) => {
    const key = `${row.side}|${row.country}|${row.location}|${row.latitude}|${row.longitude}`;
    grouped[key] ||= {
      side: row.side,
      country: row.country,
      location: row.location,
      admin1: row.admin1,
      latitude: row.latitude,
      longitude: row.longitude,
      fatalities: 0,
      events: 0,
    };
    grouped[key].fatalities += Number(row.fatalities || 0);
    grouped[key].events += 1;
  });

  const points = Object.values(grouped).sort((a, b) => b.fatalities - a.fatalities);
  const totalFatalities = rows.reduce((sum, row) => sum + Number(row.fatalities || 0), 0);
  const maxFatalities = Math.max(...points.map((row) => row.fatalities), 1);
  const iranFatalities = rows.filter((row) => row.side === "Iran").reduce((sum, row) => sum + Number(row.fatalities || 0), 0);
  const israelUsFatalities = rows
    .filter((row) => row.side === "Israel/US")
    .reduce((sum, row) => sum + Number(row.fatalities || 0), 0);

  summary.innerHTML = `
    <div class="chip"><strong>${escapeHtml(getPeriodLabel(state.fatalityMapPeriod))}</strong></div>
    <div class="chip">${escapeHtml(getPeriodDetail(state.fatalityMapPeriod))}</div>
    <div class="chip">Total fatalities: <strong>${formatNumber(totalFatalities)}</strong></div>
    <div class="chip">Iran fatalities: <strong>${formatNumber(iranFatalities)}</strong></div>
    <div class="chip">US-Israel fatalities: <strong>${formatNumber(israelUsFatalities)}</strong></div>
  `;

  drawMap("fatality", points, (row) =>
    L.circleMarker([row.latitude, row.longitude], {
      radius: Math.min(18, 4 + (row.fatalities / maxFatalities) * 14),
      color: "#08111d",
      weight: 1,
      fillColor: COLORS[row.side],
      fillOpacity: 0.55,
    }).bindPopup(`
      <strong>${escapeHtml(row.location)}</strong><br>
      ${escapeHtml(row.admin1)}, ${escapeHtml(row.country)}<br>
      ${escapeHtml(row.side)}<br>
      Fatalities: ${formatNumber(row.fatalities)}<br>
      Events: ${formatNumber(row.events)}
    `)
  );
}

function renderStrikeModes() {
  const container = document.getElementById("strikeModes");
  const grouped = {};

  plottedRows().forEach((row) => {
    grouped[row.sub_event_type] ||= { Iran: 0, "Israel/US": 0 };
    grouped[row.sub_event_type][row.side] += 1;
  });

  const modes = Object.entries(grouped)
    .map(([mode, counts]) => ({
      mode,
      Iran: counts.Iran,
      "Israel/US": counts["Israel/US"],
      total: counts.Iran + counts["Israel/US"],
    }))
    .sort((a, b) => b.total - a.total);

  const maxValue = Math.max(...modes.flatMap((mode) => [mode.Iran, mode["Israel/US"]]), 1);

  container.innerHTML = modes
    .map(
      (mode) => `
        <div class="mode-row">
          <div class="mode-label">${escapeHtml(mode.mode)}</div>
          <div class="mode-bars">
            <div class="mode-side">
              <span>Iran <strong>${formatNumber(mode.Iran)}</strong></span>
              <div class="bar-track"><div class="bar-fill iran-fill" style="width:${(mode.Iran / maxValue) * 100}%"></div></div>
            </div>
            <div class="mode-side">
              <span>US-Israel <strong>${formatNumber(mode["Israel/US"])}</strong></span>
              <div class="bar-track"><div class="bar-fill israel-fill" style="width:${(mode["Israel/US"] / maxValue) * 100}%"></div></div>
            </div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderIRGCLegend() {
  const legend = document.getElementById("irgcLegend");
  legend.innerHTML = Object.entries(state.irgcSeries)
    .map(
      ([key, series]) => `
        <button class="irgc-legend-item${series.visible ? "" : " off"}" data-irgc-key="${key}" type="button">
          <span class="irgc-swatch" style="background:${series.color}"></span>
          <span>${escapeHtml(series.label)}</span>
        </button>
      `
    )
    .join("");

  legend.querySelectorAll("[data-irgc-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.irgcKey;
      state.irgcSeries[key].visible = !state.irgcSeries[key].visible;
      renderIRGCChart();
    });
  });
}

function renderIRGCChart() {
  renderIRGCLegend();
  const svg = document.getElementById("irgcChart");
  const tooltip = document.getElementById("irgcTooltip");
  if (!svg || !tooltip) {
    return;
  }

  const missilesEMA = ema(IRGC_RAW.map((d) => d.missiles), 2);
  const dronesEMA = ema(IRGC_RAW.map((d) => d.drones), 2);
  const rows = IRGC_RAW.map((row, index) => ({
    ...row,
    missilesEMA: Math.round(missilesEMA[index]),
    dronesEMA: Math.round(dronesEMA[index]),
  }));

  const visibleKeys = Object.keys(state.irgcSeries).filter((key) => state.irgcSeries[key].visible);
  const W = 1100;
  const H = 620;
  const margin = { top: 34, right: 130, bottom: 58, left: 68 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const maxY = Math.max(...rows.flatMap((row) => visibleKeys.map((key) => row[key])), 100);

  function xScale(i) {
    return margin.left + (i / (rows.length - 1)) * innerW;
  }

  function yScale(v) {
    return margin.top + innerH - (v / maxY) * innerH;
  }

  function fmtDate(dateStr) {
    const dt = new Date(`${dateStr}T00:00:00`);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function linePath(key) {
    return rows.map((row, i) => `${i === 0 ? "M" : "L"} ${xScale(i).toFixed(2)} ${yScale(row[key]).toFixed(2)}`).join(" ");
  }

  const ticks = Array.from({ length: 6 }, (_, i) => {
    const value = (maxY / 5) * i;
    const y = yScale(value);
    return `
      <line x1="${margin.left - 6}" y1="${y}" x2="${margin.left}" y2="${y}" stroke="#C9D2DC"></line>
      <line x1="${margin.left}" y1="${y}" x2="${margin.left + innerW}" y2="${y}" stroke="#F0F3F7"></line>
      <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" class="axis-label">${Math.round(value)}</text>
    `;
  }).join("");

  const xLabels = rows
    .map((row, i) => {
      if (i % 2 !== 0 && i !== rows.length - 1) {
        return "";
      }
      const x = xScale(i);
      return `
        <line x1="${x}" y1="${margin.top + innerH}" x2="${x}" y2="${margin.top + innerH + 6}" stroke="#C9D2DC"></line>
        <text x="${x}" y="${margin.top + innerH + 24}" text-anchor="middle" class="axis-label">${fmtDate(row.date)}</text>
      `;
    })
    .join("");

  const seriesLines = visibleKeys
    .map((key) => `<path d="${linePath(key)}" fill="none" stroke="${state.irgcSeries[key].color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>`)
    .join("");

  const endLabels = visibleKeys
    .map((key) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      return `
        <circle cx="${xScale(0)}" cy="${yScale(first[key])}" r="6" fill="${state.irgcSeries[key].color}" stroke="#fff" stroke-width="3"></circle>
        <circle cx="${xScale(rows.length - 1)}" cy="${yScale(last[key])}" r="6" fill="${state.irgcSeries[key].color}" stroke="#fff" stroke-width="3"></circle>
        <text x="${xScale(0) + 10}" y="${yScale(first[key]) - 12}" fill="${state.irgcSeries[key].color}" class="irgc-start-label">${Math.round(first[key])}</text>
        <text x="${xScale(rows.length - 1) + 12}" y="${yScale(last[key])}" fill="${state.irgcSeries[key].color}" class="irgc-value-label">${escapeHtml(state.irgcSeries[key].label.split(" ")[0])} ${Math.round(last[key])}</text>
      `;
    })
    .join("");

  svg.innerHTML = `
    <rect x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}" fill="#fff"></rect>
    <line x1="${margin.left}" y1="${margin.top + innerH}" x2="${margin.left + innerW}" y2="${margin.top + innerH}" stroke="#C9D2DC"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}" stroke="#C9D2DC"></line>
    ${ticks}
    ${xLabels}
    ${seriesLines}
    ${endLabels}
  `;

  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let index = Math.round(((x - margin.left) / innerW) * (rows.length - 1));
    index = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[index];

    const tooltipRows = [];
    if (state.irgcSeries.dronesEMA.visible) {
      tooltipRows.push(`<div class="irgc-tooltip-row"><span style="color:${state.irgcSeries.dronesEMA.color}">Drones EMA</span><span>${row.dronesEMA}</span></div>`);
    }
    if (state.irgcSeries.missilesEMA.visible) {
      tooltipRows.push(`<div class="irgc-tooltip-row"><span style="color:${state.irgcSeries.missilesEMA.color}">Missiles EMA</span><span>${row.missilesEMA}</span></div>`);
    }

    tooltip.innerHTML = `<div class="irgc-tooltip-date">${fmtDate(row.date)}</div>${tooltipRows.join("")}`;
    tooltip.style.opacity = "1";
    tooltip.style.left = `${((xScale(index) / W) * rect.width)}px`;
    tooltip.style.top = `${(((Math.min(yScale(row.dronesEMA), yScale(row.missilesEMA))) / H) * rect.height) + 14}px`;
  };

  svg.onmouseleave = () => {
    tooltip.style.opacity = "0";
  };
}

function init() {
  state.periods = buildPeriods(state.records);
  if (!state.records.length) {
    document.body.insertAdjacentHTML("afterbegin", '<div class="empty" style="margin:20px;">No ACLED data loaded.</div>');
    return;
  }
  buildHeroStats();
  setupSelectors();
  renderIRGCChart();
  renderTrend();
  renderAttackMap();
  renderFatalityMap();
  renderStrikeModes();
}

init();
