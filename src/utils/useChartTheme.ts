import { useState, useEffect } from 'react';

type Theme = 'dark' | 'light';

interface ChartColors {
  applyStroke: string;
  applyStopColor1: string;
  applyStopColor2: string;
  transportStroke: string;
  transportStopColor1: string;
  transportStopColor2: string;
  gridStroke: string;
  axisTickFill: string;
  axisLineStroke: string;
  brushFill: string;
  brushStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  activeDotFill: string;
  warningLineStroke: string;
  dangerLineStroke: string;
  accentBg: string;
}

const DARK_CHART: ChartColors = {
  applyStroke: '#00d4ff',
  applyStopColor1: 'rgba(0,212,255,0.3)',
  applyStopColor2: 'rgba(0,212,255,0)',
  transportStroke: '#a855f7',
  transportStopColor1: 'rgba(168,85,247,0.3)',
  transportStopColor2: 'rgba(168,85,247,0)',
  gridStroke: 'rgba(255,255,255,0.05)',
  axisTickFill: '#6b7280',
  axisLineStroke: 'rgba(255,255,255,0.1)',
  brushFill: 'rgba(0,0,0,0.5)',
  brushStroke: 'rgba(0,212,255,0.3)',
  tooltipBg: 'rgba(10,14,39,0.95)',
  tooltipBorder: 'rgba(0,212,255,0.3)',
  tooltipText: '#9ca3af',
  activeDotFill: '#0a0e27',
  warningLineStroke: 'rgba(234,179,8,0.3)',
  dangerLineStroke: 'rgba(239,68,68,0.3)',
  accentBg: 'rgba(0,212,255,0.05)',
};

const LIGHT_CHART: ChartColors = {
  applyStroke: '#c04000',
  applyStopColor1: 'rgba(192,64,0,0.15)',
  applyStopColor2: 'rgba(192,64,0,0)',
  transportStroke: '#7c3aed',
  transportStopColor1: 'rgba(124,58,237,0.15)',
  transportStopColor2: 'rgba(124,58,237,0)',
  gridStroke: 'rgba(61,50,41,0.08)',
  axisTickFill: '#8c7a6b',
  axisLineStroke: 'rgba(61,50,41,0.1)',
  brushFill: 'rgba(61,50,41,0.08)',
  brushStroke: 'rgba(192,64,0,0.2)',
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(192,64,0,0.2)',
  tooltipText: '#5c4f46',
  activeDotFill: '#ffffff',
  warningLineStroke: 'rgba(202,138,4,0.4)',
  dangerLineStroke: 'rgba(220,38,38,0.4)',
  accentBg: 'rgba(192,64,0,0.05)',
};

export function useChartTheme(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? LIGHT_CHART : DARK_CHART;
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute('data-theme');
      setColors(attr === 'light' ? LIGHT_CHART : DARK_CHART);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
