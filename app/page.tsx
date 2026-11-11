// 1. Update text string (and optional text fill colour)
const setJsonLayerText = (
  animData: any,
  layerName: string,
  newText: string,
  tracking?: number,
  hexColor?: string
) => {
  const updateLayers = (layers: any[]) => {
    layers.forEach((layer) => {
      if (layer.nm === layerName && layer.t?.d?.k?.[0]?.s) {
        const textDoc = layer.t.d.k[0].s;
        textDoc.t = newText;
        if (tracking !== undefined) {
          textDoc.tr = tracking;
        }
        if (hexColor) {
          textDoc.fc = hexToLottieColor(hexColor).slice(0, 3);
        }
      }
      if (layer.layers) updateLayers(layer.layers);
    });
  };

  if (animData.layers) updateLayers(animData.layers);
  if (animData.assets) {
    animData.assets.forEach((asset: any) => {
      if (asset.layers) updateLayers(asset.layers);
    });
  }
};

// 2. Merged Shape Fill + Secondary Stroke + Primary Position Text helper
const setShapeLayerHex = (
  animData: any,
  layerName: string,
  hexColor: string,
  optionalStrokeHex?: string
) => {
  const rgba = hexToLottieColor(hexColor);
  const rgb = rgba.slice(0, 3);
  const strokeRgba = optionalStrokeHex ? hexToLottieColor(optionalStrokeHex) : null;

  const setFillOnShapes = (shapes: any[], fillColour: number[], strokeColour?: number[] | null) => {
    shapes.forEach((item) => {
      if (item.ty === 'fl' && item.c?.k) {
        item.c.k = fillColour;
      }
      if (item.ty === 'st' && strokeColour && item.c?.k) {
        item.c.k = strokeColour;
        item.hd = false;
      }
      if (item.it) setFillOnShapes(item.it, fillColour, strokeColour);
    });
  };

  const setStrokeOnlyOnShapes = (shapes: any[], strokeColour: number[]) => {
    shapes.forEach((item) => {
      if (item.ty === 'st' && item.c?.k) {
        item.c.k = strokeColour;
        item.hd = false;
      }
      if (item.it) setStrokeOnlyOnShapes(item.it, strokeColour);
    });
  };

  const walkAllLayers = (callback: (layer: any) => void) => {
    const walk = (layers: any[]) => {
      layers.forEach((layer) => {
        callback(layer);
        if (layer.layers) walk(layer.layers);
      });
    };
    if (animData.layers) walk(animData.layers);
    if (animData.assets) {
      animData.assets.forEach((asset: any) => {
        if (asset.layers) walk(asset.layers);
      });
    }
  };

  // Apply fill (and optional stroke) to the target shape layer
  walkAllLayers((layer) => {
    if (layer.nm === layerName && layer.shapes) {
      setFillOnShapes(layer.shapes, rgba, strokeRgba);
    }
  });

  // Auto-hook 1: When Shape_Team_X is given the Primary Colour, also colour Text_Team_Position_X
  if (layerName.startsWith('Shape_Team_')) {
    const idx = layerName.replace('Shape_Team_', '');
    const posLayerName = `Text_Team_Position_${idx}`;
    walkAllLayers((layer) => {
      if (layer.nm === posLayerName && layer.t?.d?.k?.[0]?.s) {
        layer.t.d.k[0].s.fc = rgb;
      }
    });
  }

  // Auto-hook 2: When Shape_Overlay_Team_X is given the Secondary Colour, also colour Shape_Team_X's stroke
  if (layerName.startsWith('Shape_Overlay_Team_')) {
    const idx = layerName.replace('Shape_Overlay_Team_', '');
    const mainShapeName = `Shape_Team_${idx}`;
    walkAllLayers((layer) => {
      if (layer.nm === mainShapeName && layer.shapes) {
        setStrokeOnlyOnShapes(layer.shapes, rgba);
      }
    });
  }
};