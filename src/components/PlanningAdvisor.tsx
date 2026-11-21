import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';
import type { ChatMessage, ChatModelId, SiteAssessment } from '../types/site';

interface PlanningAdvisorProps {
  assessment: SiteAssessment | null;
  messages: ChatMessage[];
  selectedModel: ChatModelId;
  onModelChange: (model: ChatModelId) => void;
  onMessagesChange: (messages: ChatMessage[]) => void;
  compact?: boolean;
}

const MODEL_OPTIONS: Array<{ id: ChatModelId; label: string; roleNote: string }> = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Free)', roleNote: 'General planning & site synthesis' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Free)', roleNote: 'Fast data lookup & quick checks' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon', roleNote: 'Complex interactive cost modeling' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', roleNote: 'Deep climate & civil reasoning' },
];

const STARTER_PROMPTS = [
  'Which single environmental constraint poses the largest 10-to-25 year financial risk here?',
  'How should we orient buildings and green buffers to cut peak cooling demand?',
  'Should we relocate this project 10–15 km away or mitigate on-site?',
  'Explain the stormwater and drainage engineering needed for this terrain relief.',
];

export function PlanningAdvisor({
  assessment,
  messages,
  selectedModel,
  onModelChange,
  onMessagesChange,
  compact = false,
}: PlanningAdvisorProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const buildSiteContextPayload = () => {
    if (!assessment) return null;
    const t = assessment.telemetry;
    return {
      site: t.query,
      overallSuitability: assessment.overallSuitability,
      overallVerdict: assessment.overallVerdict,
      pillars: assessment.pillars.map((p) => ({
        title: p.title,
        score: p.score,
        riskLevel: p.riskLevel,
        headline: `${p.headlineMetric} ${p.headlineUnit}`,
        findings: p.findings,
      })),
      climate: {
        tempDeltaC: t.climate.tempDeltaC,
        futureExtremeHeatDaysPerYr: t.climate.futureExtremeHeatDaysPerYr,
        precipChangePct: t.climate.precipChangePct,
      },
      elevation: {
        centerMeters: t.elevation.centerMeters,
        reliefMeters: t.elevation.reliefMeters,
        slopePct: t.elevation.estimatedSlopePct,
      },
      airQuality: t.airQuality,
      flood: t.flood,
      nasaSolarKwhM2Day: t.nasaPower.solarIrradianceKwhM2Day,
      landUse2Km: {
        greenFeaturesCount: t.landUse2Km.greenFeaturesCount,
        waterFeaturesCount: t.landUse2Km.waterFeaturesCount,
        urbanBuiltCount: t.landUse2Km.urbanBuiltCount,
        industrialCount: t.landUse2Km.industrialCount,
      },
      costProjectionInrCr: assessment.costProjection,
    };
  };

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isSending) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}_u`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    onMessagesChange(nextMessages);
    setInput('');
    setIsSending(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
          siteContext: buildSiteContextPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Chat request failed.');
      }

      const modelMsg: ChatMessage = {
        id: `${Date.now()}_m`,
        role: 'model',
        text: data.reply,
        model: selectedModel,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onMessagesChange([...nextMessages, modelMsg]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to reach Planning Advisor.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const containerClass = compact
    ? 'flex flex-col h-full bg-white border border-slate-200 rounded overflow-hidden'
    : 'max-w-[1040px] mx-auto px-4 sm:px-6 py-6 h-[calc(100vh-80px)] flex flex-col';

  return (
    <div className={containerClass}>
      <div
        className={`flex flex-col flex-1 min-h-0 bg-white ${
          compact ? '' : 'border border-slate-200 rounded overflow-hidden'
        }`}
      >
        <div className="px-4 py-3 border-b border-slate-200 bg-[#0f2557] text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-bold text-white">
              Urban Planning &amp; Climate Advisor
            </h2>
            <p className="text-xs text-lime-300">
              {assessment
                ? `Grounded in ${assessment.telemetry.query.label} (${assessment.overallSuitability}/100 suitability)`
                : 'Select or analyze a site to attach live telemetry context'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Select Gemini reasoning model"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value as ChatModelId)}
              className="text-xs font-medium text-[#0f2557] bg-white border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} — {opt.roleNote}
                </option>
              ))}
            </select>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onMessagesChange([]);
                  setErrorMsg(null);
                }}
                title="Clear conversation"
                className="p-1.5 text-slate-200 hover:text-white border border-blue-800 bg-blue-950 rounded"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-start max-w-xl mx-auto space-y-4 py-6">
              <div>
                <h3 className="text-base font-display font-bold text-[#0f2557]">
                  Ask about climate trade-offs, engineering fixes, or alternative siting
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Conversation history persists across turns and includes the active site’s Copernicus elevation, CMIP6 projections, CAMS air quality, GloFAS flood ratio, NASA solar insolation, and 25-year cost numbers.
                </p>
              </div>
              <div className="w-full space-y-2">
                {STARTER_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-[#0f2557] bg-slate-50 hover:bg-lime-50 hover:border-lime-600 border border-slate-200 rounded transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className="text-[11px] font-mono text-slate-400 mb-1 px-1">
                  {msg.role === 'user' ? 'Planner' : msg.model || selectedModel} · {msg.timestamp}
                </div>
                <div
                  className={`max-w-[85%] rounded px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#0f2557] text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-lime-600" />
              <span>Evaluating site telemetry with {selectedModel}...</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about heat mitigation, flood setbacks, CapEx ROI, or nearby alternatives..."
            className="flex-1 px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded focus:outline-none focus:border-[#0f2557]"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="px-3.5 py-2 bg-lime-600 hover:bg-lime-700 disabled:opacity-50 text-white text-xs font-bold rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        </form>
      </div>
    </div>
  );
}
