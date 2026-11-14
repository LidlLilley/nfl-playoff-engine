'use client';

import React, { useEffect, useRef, useState } from 'react';

interface SeedEntry {
  seed: number;
  teamId: string;
  name?: string;
  nickname: string;
  division?: string;
  record: string;
  winPct?: number;
  primaryHex: string;
  secondaryHex: string;
  crestUrl: string;
  reason?: string;
}

// Clean white NFC logo SVG encoded as a Data URI
const NFC_LOGO_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="Impact, Arial Black, sans-serif" font-size="64" font-weight="900" letter-spacing="2">NFC</text>
    </svg>
  `);

// Helper: Convert Hex (#RRGGBB) to Lottie normalized RGB array [r, g, b, 1]
function hexToLottieColor(hex: string): [number, number, number, number] {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return [
    Number(r.toFixed(4)),
    Number(g.toFixed(4)),
    Number(b.toFixed(4)),
    1,
  ];
}

// Helper: Update text content on a Lottie Text Layer
function setJsonLayerText(lottieJson: any, layerName: string, newText: string) {
  const layer = lottieJson.layers?.find((l: any) => l.nm === layerName);
  if (layer?.t?.d?.k?.[0]?.s) {
    layer.t.d.k[0].s.t = newText;
  }
}

// Helper: Update fill colour on a Lottie Text Layer
function setTextLayerHex(lottieJson: any, layerName: string, hexColor: string) {
  const layer = lottieJson.layers?.find((l: any) => l.nm === layerName);
  if (layer?.t?.d?.k?.[0]?.s) {
    const [r, g, b] = hexToLottieColor(hexColor);
    layer.t.d.k[0].s.fc = [r, g, b];
  }
}

// Helper: Update Fill and optional Stroke on a Lottie Shape Layer
function setShapeLayerHex(
  lottieJson: any,
  layerName: string,
  fillHex: string,
  strokeHex?: string
) {
  const layer = lottieJson.layers?.find((l: any) => l.nm === layerName);
  if (!layer || !layer.shapes) return;

  const fillRgba = hexToLottieColor(fillHex);
  const strokeRgba = strokeHex ? hexToLottieColor(strokeHex) : null;

  const traverseShapes = (items: any[]) => {
    for (const item of items) {
      if (item.ty === 'fl' && item.c?.k) {
        item.c.k = fillRgba;
      }
      if (item.ty === 'st' && strokeRgba && item.c?.k) {
        item.c.k = strokeRgba;
      }
      if (item.it) {
        traverseShapes(item.it);
      }
    }
  };

  traverseShapes(layer.shapes);
}

// Helper: Recolour the red AFC background image to NFC Navy Blue (#002744) while keeping white stars
async function createNfcBackground(base64Src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Keep dark border pixels dark, and white star pixels white
        const isDarkBorder = r < 45 && g < 45 && b < 45;
        const isWhiteStar = r > 200 && g > 200 && b > 200;

        if (!isDarkBorder && !isWhiteStar) {
          // Map red/crimson tones to NFC Navy (#002744 -> R:0, G:39, B:68)
          const intensity = r / 215;
          data[i] = Math.min(255, Math.round(0 * intensity));
          data[i + 1] = Math.min(255, Math.round(39 * intensity));
          data[i + 2] = Math.min(255, Math.round(68 * intensity));
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(base64Src);
    img.src = base64Src;
  });
}

export default function PlayoffEnginePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<any>(null);

  const [selectedConference, setSelectedConference] = useState<'AFC' | 'NFC'>('AFC');
  const [selectedWeek, setSelectedWeek] = useState<number>(10);
  const [standings, setStandings] = useState<SeedEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasInitializedWeek, setHasInitializedWeek] = useState<boolean>(false);

  // 1. Fetch standings from our Node.js API route
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const queryUrl = hasInitializedWeek
      ? `/api/playoffs?conference=${selectedConference}&week=${selectedWeek}`
      : `/api/playoffs?conference=${selectedConference}`;

    fetch(queryUrl)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.week && !hasInitializedWeek) {
          setSelectedWeek(data.week);
          setHasInitializedWeek(true);
        }
        if (data.seeds) {
          setStandings(data.seeds);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading standings:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedConference, selectedWeek, hasInitializedWeek]);

  // 2. Load and inject data into the Lottie JSON template
  useEffect(() => {
    if (!standings.length || !containerRef.current) return;

    let isCancelled = false;

    async function renderPlayoffGraphic() {
      try {
        const lottie = (await import('lottie-web')).default;
        const response = await fetch('/nfl-playoff-engine.json');
        const rawJson = await response.json();

        if (isCancelled || !containerRef.current) return;

        // Update Week Header
        setJsonLayerText(rawJson, 'Text_Week', `WEEK ${selectedWeek}`);

        // Set Conference Matchup Box Colours (#7F0614 for AFC, #002744 for NFC)
        const boxHex = selectedConference === 'AFC' ? '#7F0614' : '#002744';
        for (let i = 1; i <= 3; i++) {
          setShapeLayerHex(rawJson, `Shape_Box_${i}`, boxHex);
        }

        // Swap Conference Logo & Background if NFC is selected
        if (selectedConference === 'NFC') {
          const logoAsset = rawJson.assets?.find((a: any) => a.id === 'image_1');
          if (logoAsset) {
            logoAsset.p = NFC_LOGO_DATA_URI;
            logoAsset.u = '';
            logoAsset.e = 1;
          }

          const bgAsset = rawJson.assets?.find((a: any) => a.id === 'image_2');
          if (bgAsset?.p) {
            bgAsset.p = await createNfcBackground(bgAsset.p);
          }
        }

        // Inject seeds 1 to 7 into their corresponding layers
        standings.slice(0, 7).forEach((team, index) => {
          const rank = index + 1;

          // Update Team Name, Record, and Seed Number
          setJsonLayerText(rawJson, `Text_Team_${rank}`, team.nickname.toUpperCase());
          setJsonLayerText(rawJson, `Text_Record_Team_${rank}`, team.record);
          setJsonLayerText(rawJson, `Text_Team_Position_${rank}`, String(team.seed));

          // Style Position Text with Primary Colour & Overlay Box with Secondary Colour
          setTextLayerHex(rawJson, `Text_Team_Position_${rank}`, team.primaryHex);
          setShapeLayerHex(rawJson, `Shape_Overlay_Team_${rank}`, team.secondaryHex);

          // Style Main Team Bar with Primary Fill and Secondary Stroke
          setShapeLayerHex(
            rawJson,
            `Shape_Team_${rank}`,
            team.primaryHex,
            team.secondaryHex
          );

          // Inject Team Crest Image
          const crestAssetId = `crest_team_${rank}`;
          rawJson.assets.push({
            id: crestAssetId,
            w: 363,
            h: 251,
            u: '',
            p: team.crestUrl,
            e: 1,
          });

          const crestLayer = rawJson.layers?.find(
            (l: any) => l.nm === `Image_Crest_${rank}`
          );
          if (crestLayer) {
            crestLayer.refId = crestAssetId;
          }
        });

        // Clean up previous Lottie instance
        if (animRef.current) {
          animRef.current.destroy();
        }
        containerRef.current.innerHTML = '';

        // Initialize Lottie and play intro animation (frames 0 to 340)
        const anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: false,
          autoplay: false,
          animationData: rawJson,
        });

        animRef.current = anim;
        anim.playSegments([0, 340], true);
      } catch (err) {
        console.error('Failed to render Lottie graphic:', err);
      }
    }

    renderPlayoffGraphic();

    return () => {
      isCancelled = true;
      if (animRef.current) {
        animRef.current.destroy();
      }
    };
  }, [standings, selectedConference, selectedWeek]);

  return (
    <main className="min-h-screen bg-[#0a0d14] text-white flex flex-col items-center py-8 px-4">
      <div className="max-w-4xl w-full flex flex-col items-center gap-6">
        {/* Controls Header */}
        <div className="w-full flex flex-wrap items-center justify-between gap-4 bg-[#131824] p-4 rounded-xl border border-white/10">
          {/* Conference Toggle */}
          <div className="flex items-center gap-2">
            {(['AFC', 'NFC'] as const).map((conf) => (
              <button
                key={conf}
                onClick={() => setSelectedConference(conf)}
                className={`px-5 py-2 rounded-lg font-bold tracking-wider transition ${
                  selectedConference === conf
                    ? conf === 'AFC'
                      ? 'bg-[#D50A0A] text-white shadow-lg'
                      : 'bg-[#013369] text-white shadow-lg'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {conf}
              </button>
            ))}
          </div>

          {/* Week Selector & Replay Button */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-300">WEEK:</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="bg-[#0a0d14] text-white font-bold px-3 py-2 rounded-lg border border-white/15 focus:outline-none"
            >
              {Array.from({ length: 18 }, (_, i) => i + 1).map((weekNum) => (
                <option key={weekNum} value={weekNum}>
                  Week {weekNum}
                </option>
              ))}
            </select>

            <button
              onClick={() => animRef.current?.playSegments([0, 340], true)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition"
            >
              ↻ Replay Animation
            </button>
          </div>
        </div>

        {/* Lottie Graphic Container */}
        <div className="relative w-full max-w-[440px] aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">
          {loading && (
            <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center font-bold tracking-widest text-sm uppercase">
              Syncing Standings...
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>
    </main>
  );
}