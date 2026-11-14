'use client';

import React, { useEffect, useRef, useState } from 'react';
import lottie, { AnimationItem } from 'lottie-web';

interface SeedEntry {
  seed: number;
  id: string;
  nickname: string;
  conference: 'AFC' | 'NFC';
  record: string;
  primaryHex: string;
  secondaryHex: string;
  crestUrl: string;
}

// Teams whose monochrome dark logos blend into their dark primary row bars
const WHITE_CREST_TEAMS = new Set(['NYG', 'NYJ']);

function hexToLottieColor(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '').trim();
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [Number(r.toFixed(4)), Number(g.toFixed(4)), Number(b.toFixed(4)), 1];
}

// Convert embedded AFC background (image_2) into pixel-identical bg-nfc.png (#003B66 navy + exact white stars)
function generateExactNfcBgFromAfc(afcBase64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 1080;
      canvas.height = img.height || 1920;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(afcBase64);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Exact bg-nfc.png Navy Blue RGB: (0, 59, 102) -> #003B66
      for (let i = 0; i < data.length; i += 4) {
        const g = data[i + 1];
        // Measure star whiteness from the green channel (13 in AFC red -> 255 in white star)
        const t = Math.max(0, Math.min(1, (g - 13) / (255 - 13)));
        data[i] = Math.round(t * 255); // R: 0 -> 255
        data[i + 1] = Math.round(59 + t * (255 - 59)); // G: 59 -> 255
        data[i + 2] = Math.round(102 + t * (255 - 102)); // B: 102 -> 255
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(afcBase64);
    img.src = afcBase64;
  });
}

export default function PlayoffEnginePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const rawJsonRef = useRef<any>(null);
  const nfcBgDataUriRef = useRef<string | null>(null);

  const [selectedWeek, setSelectedWeek] = useState<number>(9);
  const [selectedConference, setSelectedConference] = useState<'AFC' | 'NFC'>('AFC');
  const [standings, setStandings] = useState<SeedEntry[]>([]);
  const [templateReady, setTemplateReady] = useState<boolean>(false);
  const [maxWeek, setMaxWeek] = useState<number>(9);

  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  useEffect(() => {
    fetch(`/nfl-playoff-engine.json?v=${Date.now()}`)
      .then((res) => res.json())
      .then(async (json) => {
        rawJsonRef.current = json;
        const afcBgAsset = json?.assets?.find((a: any) => a.id === 'image_2');
        if (afcBgAsset?.p) {
          nfcBgDataUriRef.current = await generateExactNfcBgFromAfc(afcBgAsset.p);
        }
        setTemplateReady(true);
      })
      .catch((err) => console.error('Failed to load nfl-playoff-engine.json:', err));
  }, []);

  useEffect(() => {
    fetch(`/api/playoffs?week=${selectedWeek}&conference=${selectedConference}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.maxCompletedWeek) {
          setMaxWeek(data.maxCompletedWeek);
        }
        if (data?.standings) {
          setStandings(data.standings);
        }
      })
      .catch((err) => console.error('Failed to fetch standings:', err));
  }, [selectedWeek, selectedConference]);

  useEffect(() => {
    if (!templateReady || !rawJsonRef.current || standings.length < 7 || !containerRef.current) {
      return;
    }

    if (animRef.current) {
      animRef.current.destroy();
      animRef.current = null;
    }

    const animationData = JSON.parse(JSON.stringify(rawJsonRef.current));

    // Updates text value AND optional text fill colour (fc)
    const setJsonLayerText = (layerName: string, textValue: string, hexColor?: string) => {
      const layer = animationData.layers?.find((l: any) => l.nm === layerName);
      if (layer?.t?.d?.k?.[0]?.s) {
        layer.t.d.k[0].s.t = String(textValue).toUpperCase();
        if (hexColor) {
          layer.t.d.k[0].s.fc = hexToLottieColor(hexColor).slice(0, 3);
        }
      }
    };

    // Updates shape fill (primaryHex) AND optional shape stroke (secondaryHex)
    const setShapeLayerHex = (layerName: string, fillHex: string, strokeHex?: string) => {
      const layer = animationData.layers?.find((l: any) => l.nm === layerName);
      if (!layer?.shapes) return;
      const fillRgba = hexToLottieColor(fillHex);
      const strokeRgba = strokeHex ? hexToLottieColor(strokeHex) : null;

      const walkShapes = (items: any[]) => {
        for (const item of items) {
          if (item.ty === 'fl' && item.c?.k) {
            item.c.k = fillRgba;
          }
          if (item.ty === 'st' && strokeRgba && item.c?.k) {
            item.c.k = strokeRgba;
            item.hd = false;
          }
          if (item.it) walkShapes(item.it);
        }
      };
      walkShapes(layer.shapes);
    };

    const fixOverlayParentingAndHeight = (slot: number) => {
      if (slot === 1) return;
      const overlayLayer = animationData.layers?.find(
        (l: any) => l.nm === `Shape_Overlay_Team_${slot}`
      );
      if (!overlayLayer) return;

      delete overlayLayer.tt;
      delete overlayLayer.tp;

      const pathItem = overlayLayer.shapes?.[0]?.it?.find((item: any) => item.ty === 'sh');
      if (pathItem?.ks?.k?.v) {
        pathItem.ks.k.v = [
          [-364.729, -113.033],
          [-364.729, 47.883],
          [-477.922, 47.883],
          [-477.922, -113.033]
        ];
      }
    };

    const injectLayerImage = (
      layerName: string,
      uniqueAssetId: string,
      imageUrl: string,
      forceWhiteCrest: boolean
    ) => {
      const layer = animationData.layers?.find((l: any) => l.nm === layerName);
      if (!layer || !animationData.assets) return;

      const sourceAsset = animationData.assets.find((a: any) => a.id === layer.refId);
      if (!sourceAsset) return;

      const cloned = JSON.parse(JSON.stringify(sourceAsset));
      cloned.id = uniqueAssetId;
      cloned.p = imageUrl;
      cloned.u = '';
      cloned.e = 1;

      layer.refId = uniqueAssetId;
      if (forceWhiteCrest) {
        layer.cl = 'white-crest';
      }
      animationData.assets.push(cloned);
    };

    setJsonLayerText('Text_Week', `WEEK ${selectedWeek}`);
    setJsonLayerText('Text_Title', 'PLAYOFF PICTURE');

    // Set Shape_Box_1, Shape_Box_2, and Shape_Box_3 colours (#7F0614 for AFC, #002744 for NFC)
    const boxHex = selectedConference === 'AFC' ? '#7F0614' : '#002744';
    for (let i = 1; i <= 3; i++) {
      setShapeLayerHex(`Shape_Box_${i}`, boxHex);
    }

    if (selectedConference === 'NFC' && animationData.assets) {
      const logoAsset = animationData.assets.find((a: any) => a.id === 'image_1');
      if (logoAsset) {
        logoAsset.p = '/nfc-logo.png';
        logoAsset.u = '';
        logoAsset.e = 1;
      }
      const bgAsset = animationData.assets.find((a: any) => a.id === 'image_2');
      if (bgAsset && nfcBgDataUriRef.current) {
        bgAsset.p = nfcBgDataUriRef.current;
        bgAsset.u = '';
        bgAsset.e = 1;
      }
    }

    // Map After Effects layer slots to NFL Wild Card Matchups (#7@#2, #6@#3, #5@#4)
    const bracketSlotMap: { slot: number; team: SeedEntry }[] = [
      { slot: 1, team: standings[0] }, // #1 Seed (First-Round Bye)
      { slot: 3, team: standings[6] }, // #7 Seed (Top of Matchup Box 1)
      { slot: 2, team: standings[1] }, // #2 Seed (Bottom of Matchup Box 1)
      { slot: 5, team: standings[5] }, // #6 Seed (Top of Matchup Box 2)
      { slot: 4, team: standings[2] }, // #3 Seed (Bottom of Matchup Box 2)
      { slot: 7, team: standings[4] }, // #5 Seed (Top of Matchup Box 3)
      { slot: 6, team: standings[3] }, // #4 Seed (Bottom of Matchup Box 3)
    ];

    // --- TEAM LOOP ---
    bracketSlotMap.forEach(({ slot, team }) => {
      if (!team) return;
      const forceWhite = WHITE_CREST_TEAMS.has(team.id);

      // Position number in team's primary colour
      setJsonLayerText(`Text_Team_Position_${slot}`, String(team.seed), team.primaryHex);
      setJsonLayerText(`Text_Team_${slot}`, team.nickname);
      setJsonLayerText(`Text_Record_Team_${slot}`, team.record);

      // Shape_Team_X fill in primary colour + stroke in secondary colour
      setShapeLayerHex(`Shape_Team_${slot}`, team.primaryHex, team.secondaryHex);
      setShapeLayerHex(`Shape_Overlay_Team_${slot}`, team.secondaryHex);

      fixOverlayParentingAndHeight(slot);
      injectLayerImage(`Image_Crest_${slot}`, `crest_slot_${slot}_${team.id}`, team.crestUrl, forceWhite);
    });

    if (Array.isArray(animationData.layers)) {
      const expandedLayers: any[] = [];
      for (const layer of animationData.layers) {
        expandedLayers.push(layer);
        if (layer.td === 1 && typeof layer.nm === 'string' && layer.nm.startsWith('Shape_Team_')) {
          const visibleBar = JSON.parse(JSON.stringify(layer));
          delete visibleBar.td;
          visibleBar.ind = layer.ind + 200;
          visibleBar.nm = `${layer.nm}_VisibleBar`;
          expandedLayers.push(visibleBar);
        }
      }
      animationData.layers = expandedLayers;
    }

    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData
    });

    anim.addEventListener('DOMLoaded', () => {
      // Play intro animation from frame 0 to 340 and hold
      anim.playSegments([0, 340], true);

      const elements = (anim as any)?.renderer?.elements;
      if (!Array.isArray(elements)) return;

      bracketSlotMap.forEach(({ slot, team }) => {
        if (!team || !WHITE_CREST_TEAMS.has(team.id)) return;
        const targetLayerName = `Image_Crest_${slot}`;
        const el = elements.find((item: any) => item?.data?.nm === targetLayerName);
        if (el?.layerElement) {
          el.layerElement.style.filter = 'brightness(0) invert(1)';
          const imgNode = el.layerElement.querySelector('image');
          if (imgNode) {
            imgNode.style.filter = 'brightness(0) invert(1)';
          }
        }
      });
    });

    animRef.current = anim;

    return () => {
      anim.destroy();
    };
  }, [templateReady, standings, selectedWeek, selectedConference]);

  return (
    <div className="page-wrapper">
      <header className="header">
        <h1 className="title">NFL PLAYOFF PICTURE ENGINE</h1>
        <p className="subtitle">Dynamic React + Node.js Broadcast Graphics Pipeline</p>
      </header>

      <div className="main-container">
        <div className="selectors-grid">
          <div className="selector-card">
            <label className="selector-label">SELECT NFL WEEK (LIVE AUTO-SYNC)</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="team-select"
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>

          <div className="selector-card">
            <label className="selector-label">SELECT CONFERENCE</label>
            <select
              value={selectedConference}
              onChange={(e) => setSelectedConference(e.target.value as 'AFC' | 'NFC')}
              className="team-select"
            >
              <option value="AFC">AFC (American Football Conference)</option>
              <option value="NFC">NFC (National Football Conference)</option>
            </select>
          </div>
        </div>

        <div className={`canvas-card ${selectedConference === 'AFC' ? 'afc-theme' : 'nfc-theme'}`}>
          <div className="conference-watermark">
            {selectedConference === 'AFC' ? 'A' : 'N'}
          </div>
          <div id="templateContainer" ref={containerRef} />
        </div>
      </div>
    </div>
  );
}