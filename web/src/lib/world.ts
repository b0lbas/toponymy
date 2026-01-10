import * as d3 from "d3";
import { feature } from "topojson-client";

export type CountryFeature = GeoJSON.Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { name: string; area?: number }
> & {
  id: string;
};

const WORLD_ATLAS_TOPOJSON =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";

const EUROPE_BBOX = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };

function inEuropeBbox([lon, lat]: [number, number]) {
  return (
    lon >= EUROPE_BBOX.lonMin &&
    lon <= EUROPE_BBOX.lonMax &&
    lat >= EUROPE_BBOX.latMin &&
    lat <= EUROPE_BBOX.latMax
  );
}

function filterToEuropeGeom(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geom.type === "Polygon") {
    // (оставляю как было по смыслу — для Европы у тебя фильтрация по ISO, так что ок)
    return geom;
  }

  const polys = geom.coordinates
    .map((coords) => ({ type: "Polygon", coordinates: coords } as GeoJSON.Polygon))
    .filter((poly) => {
      const c = d3.geoCentroid(
        { type: "Feature", geometry: poly, properties: {} } as any
      ) as [number, number];
      return inEuropeBbox(c);
    });

  if (polys.length === 0) return geom;

  return {
    type: "MultiPolygon",
    coordinates: polys.map((p) => p.coordinates),
  } as GeoJSON.MultiPolygon;
}

const EUROPE_NUM_IDS = new Set<number>([
  8, 929, 40, 56, 70, 100, 112, 191, 196, 203, 208, 233, 246, 250, 268, 276, 300,
  348, 352, 372, 380, 428, 438, 440, 442, 470, 492, 498, 499, 528, 578, 616,
  620, 642, 643, 688, 703, 705, 724, 752, 756, 792, 804, 807, 826,
  417, 398, 496, 764, 704, 116, 608, 458, 360
]);

// Дополнительно включаем вне Европы: Россия уже была, добавим Канаду (124), Гренландию (304), Мексику (484), США (840)
// + Южная Америка: Аргентина (32), Боливия (68), Бразилия (76), Чили (152), Колумбия (170), Эквадор (218), Гвиана (254), Гайана (328), Парагвай (600), Перу (604), Суринам (740), Уругвай (858), Венесуэла (862)
// + Центральная Америка: Белиз (84), Коста-Рика (188), Куба (192), Сальвадор (222), Гватемала (320), Гаити (332), Гондурас (340), Ямайка (388), Никарагуа (558), Панама (591), Пуэрто-Рико (630)
// + Африка: Алжир (12), Ангола (24), Бенин (204), Ботсвана (72), Буркина-Фасо (854), Бурунди (108), Камерун (120), Канарские острова (724), Кабо-Верде (132), ЦАР (140), Чад (148), Коморы (174), Конго (178), ДР Конго (180), Джибути (262), Египет (818), Экв. Гвинея (226), Эритрея (232), Эфиопия (231), Габон (266), Гамбия (270), Гана (288), Гвинея (324), Гвинея-Бисау (334), Кот-д'Ивуар (384), Кения (404), Лесото (426), Либерия (430), Ливия (434), Мадагаскар (450), Малави (454), Мали (466), Мавритания (478), Маврикий (480), Марокко (504), Мозамбик (508), Намибия (516), Нигер (562), Нигерия (566), Руанда (646), Св. Елена (654), Сан-Томе (678), Сенегал (686), Сейшелы (690), Сьерра-Леоне (694), Сомали (706), ЮАР (710), Южный Судан (728), Судан (729), Эсватини (748), Танзания (834), Того (768), Тунис (788), Уганда (800), Замбия (894), Зимбабве (716)
// Эти страны будут отображаться целиком (без обрезки по bbox Европы).
// Азия (новые): 004, 031, 048, 050, 051, 064, 096, 104, 116, 144, 156, 158, 275, 356, 360, 364, 368, 376, 392, 400, 408, 410, 414, 418, 422, 458, 524, 586, 608, 626, 634, 682, 702, 704, 760, 762, 764, 784, 795, 860, 887
const EXTRA_INCLUDED_IDS = new Set<number>([
  4, 12, 24, 31, 32, 36, 50, 51, 64, 68, 72, 76, 84, 96, 104, 108, 116, 120, 124, 132, 140, 144, 148, 152, 156, 158, 170, 174, 178, 180, 188, 192,
  204, 214, 218, 222, 226, 231, 232, 233, 254, 262, 266, 270, 275, 288, 304, 320, 324, 328, 332, 334, 340, 348, 352, 356, 360, 364, 368, 372, 376,
  384, 388, 392, 398, 400, 404, 408, 410, 414, 418, 422, 426, 430, 434, 438, 442, 450, 454, 458, 466, 470, 478, 480, 484, 496, 498, 499, 504, 508, 512,
  516, 524, 528, 554, 558, 562, 566, 578, 586, 591, 598, 600, 604, 608, 620, 626, 630, 634, 643, 646, 654, 678, 682, 686, 690, 694, 704, 706, 710, 716, 724, 728,
  729, 740, 748, 752, 756, 760, 762, 764, 768, 784, 788, 792, 795, 800, 804, 807, 818, 826, 834, 840, 854, 858, 860, 862, 887, 894
]);

function normIsoId(idLike: unknown): number | null {
  if (idLike === null || idLike === undefined) return null;
  const s = idLike.toString().trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** ===== FIX: unwrap антимеридиан для колец ===== */

type Position = number[];

// поворачиваем кольцо так, чтобы старт был ближе к lon=0 (стабильнее unwrap)
function rotateRingStartNearZero(ring: Position[]): Position[] {
  if (ring.length < 4) return ring;

  const isClosed =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];

  const open = isClosed ? ring.slice(0, -1) : ring.slice();
  if (open.length === 0) return ring;

  let bestIdx = 0;
  let bestScore = Math.abs(open[0][0] ?? 0);

  for (let i = 1; i < open.length; i++) {
    const lon = open[i][0] ?? 0;
    const score = Math.abs(lon);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const rotated = open.slice(bestIdx).concat(open.slice(0, bestIdx));
  if (isClosed) rotated.push(rotated[0].slice());
  return rotated;
}

function unwrapRingAntimeridian(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;

  const out: Position[] = [];
  let offset = 0;

  let prev = ring[0].slice();
  out.push(prev);

  let prevLon = prev[0] ?? 0;

  for (let i = 1; i < ring.length; i++) {
    const p = ring[i].slice();
    let lon = (p[0] ?? 0) + offset;

    const delta = lon - prevLon;
    if (delta > 180) {
      offset -= 360;
      lon -= 360;
    } else if (delta < -180) {
      offset += 360;
      lon += 360;
    }

    p[0] = lon;
    out.push(p);
    prevLon = lon;
  }

  return out;
}

function fixAntimeridianGeom<T extends GeoJSON.Polygon | GeoJSON.MultiPolygon>(geom: T): T {
  if (geom.type === "Polygon") {
    return {
      ...geom,
      coordinates: geom.coordinates.map((ring) =>
        unwrapRingAntimeridian(rotateRingStartNearZero(ring as any)) as any
      ),
    } as T;
  }

  return {
    ...geom,
    coordinates: geom.coordinates.map((poly) =>
      poly.map((ring) =>
        unwrapRingAntimeridian(rotateRingStartNearZero(ring as any)) as any
      )
    ),
  } as T;
}

/** ===== конец FIX ===== */


// ISO3-коды стран, где нет admin1-границ (использовать admin0)
const ADMIN0_ONLY_ISO3 = new Set([
  'DOM','COD','COG','CAF','GNQ','GNB','LBR','MRT','SOM','SSD','TLS','HTI','JAM','BHS','BRB','VCT','GRD','LCA','KNA','ATG','DMA','TTO','BRN','QAT','BHR','KWT','LIE','SMR','MCO','VAT','AND'
]);

export async function loadEuropeCountries(): Promise<CountryFeature[]> {
  const topo = await d3.json(WORLD_ATLAS_TOPOJSON);
  if (!topo || typeof topo !== "object")
    throw new Error("Failed to load world-atlas TopoJSON");

  const geo = feature(topo as any, (topo as any).objects.countries) as GeoJSON.FeatureCollection<
    GeoJSON.MultiPolygon | GeoJSON.Polygon,
    any
  >;

  const filtered: CountryFeature[] = [];
  for (const f of geo.features) {
    const name = (f.properties?.name ?? "Unknown").toString();
    const idNum = normIsoId(f.id);
    const iso3 = f.properties?.iso_a3 || f.properties?.ISO_A3 || null;

    // Для Австралии (id=36) включаем только если name === 'Australia'
    if (idNum === 36 && name !== "Australia") continue;

    const include =
      idNum !== null && (EUROPE_NUM_IDS.has(idNum) || EXTRA_INCLUDED_IDS.has(idNum));
    if (!include) continue;

    const stableId = idNum !== null ? String(idNum) : name;

    // Если страна из списка admin0-only, используем admin0-геометрию
    let geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    if (iso3 && ADMIN0_ONLY_ISO3.has(iso3)) {
      geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } else {
      const keepFull = idNum !== null && EXTRA_INCLUDED_IDS.has(idNum);
      geom = keepFull
        ? (f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)
        : filterToEuropeGeom(f.geometry as any);
    }

    // Debug logging for Caribbean countries
    if (idNum === 44 || idNum === 214) {
      console.warn(`[DEBUG] Country: ${name} (ID: ${idNum}), Geometry type: ${geom?.type}, Coords empty: ${!geom || geom.coordinates?.length === 0}`);
    }

    // ✅ фикс именно для России (ISO numeric 643)
    if (idNum === 643) {
      geom = fixAntimeridianGeom(geom);
    }

    const cleaned = { ...(f as any), geometry: geom };

    filtered.push({
      ...cleaned,
      id: stableId,
      properties: { name, area: d3.geoArea(cleaned as any) },
    } as CountryFeature);
  }

  filtered.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return filtered;
}
