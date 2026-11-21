import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowUpRight,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  Compass,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { ClimateCharts } from './components/ClimateCharts';
import { CompareView } from './components/CompareView';
import { ConceptStudio } from './components/ConceptStudio';
import { CornerFutureAI } from './components/CornerFutureAI';
import { MetricHelpTooltip } from './components/MetricHelpTooltip';
import { PlanningAdvisor } from './components/PlanningAdvisor';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SatelliteMap } from './components/SatelliteMap';
import { useCachedFieldSites, useOnlineStatus, type CachedFieldSiteSummary } from './hooks/useOnlineStatus';
import { evaluateSiteTelemetry } from './lib/evaluator';
import { firebaseAuth, signOutFirebase } from './lib/firebase';
import {
  getActiveSupabaseSession,
  signOutSupabase,
  supabase,
} from './lib/supabase';
import {
  BENCHMARK_CORRIDORS,
  type AiBrief,
  type AuthSessionState,
  type BenchmarkCorridor,
  type ChatMessage,
  type ChatModelId,
  type EnvironmentalTelemetry,
  type GeneratedConcept,
  type GeocodeResult,
  type HorizonYear,
  type MapLayerMode,
  type MapsGroundingResult,
  type ProjectType,
  type RiskLevel,
  type SavedAssessmentRecord,
  type SearchGroundingResult,
  type SiteAssessment,
  type SiteQuery,
} from './types/site';

type ActiveTab = 'analyzer' | 'compare' | 'studio' | 'advisor';

const PROJECT_LABELS: Record<ProjectType, string> = {
  residential_township: 'Residential Township',
  commercial_hub: 'Commercial Hub',
  industrial_park: 'Industry & Manufacturing Zone',
  medical_centre: 'Medical Centre & Hospital',
  agricultural_land: 'Agricultural Land & Agro-Park',
  solar_logistics_hub: 'Logistics & Solar Energy Park',
  green_infrastructure: 'Green Infrastructure & Sponge Park',
};

const PILLAR_HELP: Record<string, { explanation: string; budgetImpact: string }> = {
  climate: {
    explanation:
      'Measures CMIP6 warming delta and annual days >=40°C compared against the 1981–2010 historical baseline.',
    budgetImpact:
      'More extreme heat days raise peak HVAC chiller tonnage, energy OpEx, and cool-roof shading requirements.',
  },
  environment: {
    explanation:
      'Combines live CAMS particulate air quality (PM2.5) and daily water evaporation stress (ET0).',
    budgetImpact:
      'High PM2.5 and water stress demand MERV-13/HEPA intake filtration, greywater recycling, and vegetative buffers.',
  },
  geography: {
    explanation:
      'Evaluates Copernicus 90m elevation relief and GloFAS 60-day peak-to-mean river discharge ratios.',
    budgetImpact:
      'Flat basins or high flood ratios require raised critical plinths, retention ponds, and stormwater pumping.',
  },
  sustainability: {
    explanation:
      'Assesses OpenStreetMap 2 km green/water ecosystem corridors against NASA POWER solar irradiance.',
    budgetImpact:
      'Sparse surrounding green cover increases Urban Heat Island load, while high solar radiation boosts PV payback.',
  },
  feasibility: {
    explanation:
      'Calculates the net 25-year avoided cost and ROI multiple of preventive design versus unmitigated damage.',
    budgetImpact:
      'Shows how much lifecycle CapEx + OpEx your organization preserves by investing in resilience pre-construction.',
  },
};

function VerdictBadge({ level }: { level: RiskLevel }) {
  if (level === 'Nominal') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-lime-700">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Nominal
      </span>
    );
  }
  if (level === 'Moderate') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0f2557]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Moderate
      </span>
    );
  }
  if (level === 'Elevated') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Elevated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700">
      <XCircle className="w-3.5 h-3.5 shrink-0" /> Critical
    </span>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSessionState | null>(null);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [mapsQuotaWarning, setMapsQuotaWarning] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const initialCorridor = BENCHMARK_CORRIDORS[0];
  const [siteQuery, setSiteQuery] = useState<SiteQuery>({
    lat: initialCorridor.lat,
    lng: initialCorridor.lng,
    label: initialCorridor.name,
    region: initialCorridor.city,
    projectType: initialCorridor.defaultProjectType,
    areaHectares: initialCorridor.defaultAreaHectares,
    horizonYear: 2050,
  });

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [layerMode, setLayerMode] = useState<MapLayerMode>('satellite');
  const [showElevationGrid, setShowElevationGrid] = useState(true);
  const [showLandUseBuffer, setShowLandUseBuffer] = useState(true);

  const [assessment, setAssessment] = useState<SiteAssessment | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [cachedTelemetryAt, setCachedTelemetryAt] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const { cachedSites, refreshCachedSites } = useCachedFieldSites();

  const [aiBrief, setAiBrief] = useState<AiBrief | null>(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [searchGrounding, setSearchGrounding] = useState<SearchGroundingResult | null>(null);
  const [isSearchGroundingLoading, setIsSearchGroundingLoading] = useState(false);
  const [searchGroundingError, setSearchGroundingError] = useState<string | null>(null);

  const [mapsGrounding, setMapsGrounding] = useState<MapsGroundingResult | null>(null);
  const [isMapsGroundingLoading, setIsMapsGroundingLoading] = useState(false);
  const [mapsGroundingError, setMapsGroundingError] = useState<string | null>(null);

  const [cloudSavedSites, setCloudSavedSites] = useState<SavedAssessmentRecord[]>([]);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [saveDbNotice, setSaveDbNotice] = useState<string | null>(null);

  const [savedSites, setSavedSites] = useState<SiteAssessment[]>([]);
  const [isBenchmarkingAll, setIsBenchmarkingAll] = useState(false);
  const [concepts, setConcepts] = useState<GeneratedConcept[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatModel, setChatModel] = useState<ChatModelId>('gemini-4-hydrogen');

  useEffect(() => {
    const handleQuotaEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      setMapsQuotaWarning(
        detail ||
          'Google Maps Platform quota or authentication limit reached. Coordinate search and environmental telemetry remain operational.'
      );
    };
    window.addEventListener('gmp-quota-exceeded', handleQuotaEvent);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaEvent);
  }, []);

  useEffect(() => {
    let active = true;

    const syncInitial = async () => {
      const sbSession = await getActiveSupabaseSession();
      if (!active) return;
      if (sbSession?.user) {
        setAuthSession({
          provider: 'supabase',
          uid: sbSession.user.id,
          email: sbSession.user.email || 'planner@terrasight',
          emailVerified: Boolean(sbSession.user.email_confirmed_at),
          token: sbSession.access_token,
        });
        setShowAuthScreen(false);
      }
      setAuthReady(true);
    };
    syncInitial();

    const { data: sbListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session?.user) {
        setAuthSession({
          provider: 'supabase',
          uid: session.user.id,
          email: session.user.email || 'planner@terrasight',
          emailVerified: Boolean(session.user.email_confirmed_at),
          token: session.access_token,
        });
        if (event === 'SIGNED_IN') {
          setShowAuthScreen(false);
        }
      } else {
        setAuthSession((prev) => (prev?.provider === 'supabase' ? null : prev));
      }
      setAuthReady(true);
    });

    const unsubFirebase = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      if (!active) return;
      if (fbUser) {
        const token = await fbUser.getIdToken();
        setAuthSession({
          provider: 'firebase',
          uid: fbUser.uid,
          email: fbUser.email || 'google-user@terrasight',
          emailVerified: fbUser.emailVerified,
          token,
        });
        setShowAuthScreen(false);
      } else {
        setAuthSession((prev) => (prev?.provider === 'firebase' ? null : prev));
      }
      setAuthReady(true);
    });

    return () => {
      active = false;
      sbListener.subscription.unsubscribe();
      unsubFirebase();
    };
  }, []);

  const loadCloudAssessments = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/assessments', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.assessments)) {
        setCloudSavedSites(data.assessments);
      }
    } catch {
      // Ignore silent background sync errors
    }
  }, []);

  useEffect(() => {
    if (authSession?.token) {
      loadCloudAssessments(authSession.token);
    } else {
      setCloudSavedSites([]);
    }
  }, [authSession?.token, loadCloudAssessments]);

  const fetchAiBrief = useCallback(async (nextAssessment: SiteAssessment) => {
    setIsGeneratingBrief(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment: nextAssessment }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI synthesis failed.');
      }
      setAiBrief(data);
    } catch (err: any) {
      setBriefError(err?.message || 'Unable to generate AI site brief.');
      setAiBrief(null);
    } finally {
      setIsGeneratingBrief(false);
    }
  }, []);

  const fetchSearchGrounding = useCallback(async (query: SiteQuery) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSearchGrounding(null);
      setSearchGroundingError('Offline: Live web masterplan advisories will resume when connected.');
      return;
    }
    setIsSearchGroundingLoading(true);
    setSearchGroundingError(null);
    try {
      const res = await fetch('/api/ai/search-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: query.label,
          region: query.region,
          lat: query.lat,
          lng: query.lng,
          projectType: query.projectType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search Grounding failed.');
      setSearchGrounding(data);
    } catch (err: any) {
      setSearchGroundingError(err?.message || 'Live web advisories unavailable.');
      setSearchGrounding(null);
    } finally {
      setIsSearchGroundingLoading(false);
    }
  }, []);

  const fetchMapsGrounding = useCallback(async (query: SiteQuery) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setMapsGrounding(null);
      setMapsGroundingError('Offline: Nearby Google Maps context will resume when connected.');
      return;
    }
    setIsMapsGroundingLoading(true);
    setMapsGroundingError(null);
    try {
      const res = await fetch('/api/ai/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: query.label,
          region: query.region,
          lat: query.lat,
          lng: query.lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Maps Grounding failed.');
      setMapsGrounding(data);
    } catch (err: any) {
      setMapsGroundingError(err?.message || 'Surrounding Maps context unavailable.');
      setMapsGrounding(null);
    } finally {
      setIsMapsGroundingLoading(false);
    }
  }, []);

  const runAnalysis = useCallback(
    async (queryToRun: SiteQuery) => {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setCachedTelemetryAt(null);
      setAiBrief(null);
      setBriefError(null);
      setSearchGrounding(null);
      setSearchGroundingError(null);
      setMapsGrounding(null);
      setMapsGroundingError(null);
      setSaveDbNotice(null);

      try {
        const res = await fetch('/api/analyze-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryToRun),
        });
        const isCacheHit = res.headers.get('X-TerraSight-Cache') === 'HIT';
        const cachedHeaderTime = res.headers.get('X-TerraSight-Cached-At');
        const telemetry: EnvironmentalTelemetry & { error?: string } = await res.json();
        if (!res.ok) {
          throw new Error(
            telemetry.error || 'Failed to fetch live public environmental telemetry.'
          );
        }

        if (isCacheHit) {
          setCachedTelemetryAt(cachedHeaderTime || telemetry.fetchedAt || new Date().toISOString());
        } else {
          setCachedTelemetryAt(null);
        }

        const evaluated = evaluateSiteTelemetry(telemetry);
        setAssessment(evaluated);
        setIsAnalyzing(false);
        refreshCachedSites();

        fetchAiBrief(evaluated);
        fetchSearchGrounding(queryToRun);
        fetchMapsGrounding(queryToRun);
      } catch (err: any) {
        setAnalysisError(err?.message || 'Site analysis request failed.');
        setIsAnalyzing(false);
      }
    },
    [fetchAiBrief, fetchMapsGrounding, fetchSearchGrounding, refreshCachedSites]
  );

  const hasRunInitialRef = useRef(false);
  useEffect(() => {
    if (!showAuthScreen && !hasRunInitialRef.current) {
      hasRunInitialRef.current = true;
      runAnalysis(siteQuery);
    }
  }, [showAuthScreen, runAnalysis, siteQuery]);

  const handleProjectConfigChange = (
    patch: Partial<Pick<SiteQuery, 'projectType' | 'areaHectares' | 'horizonYear'>>
  ) => {
    const updated = { ...siteQuery, ...patch };
    setSiteQuery(updated);
    if (patch.horizonYear && patch.horizonYear !== siteQuery.horizonYear) {
      runAnalysis(updated);
    } else if (assessment) {
      const reEvaluated = evaluateSiteTelemetry({
        ...assessment.telemetry,
        query: updated,
      });
      setAssessment(reEvaluated);
    }
  };

  const handleSelectBenchmark = (corridor: BenchmarkCorridor) => {
    const next: SiteQuery = {
      lat: corridor.lat,
      lng: corridor.lng,
      label: corridor.name,
      region: corridor.city,
      projectType: corridor.defaultProjectType,
      areaHectares: corridor.defaultAreaHectares,
      horizonYear: siteQuery.horizonYear,
    };
    setSiteQuery(next);
    setSearchResults([]);
    runAnalysis(next);
  };

  const handleMapClick = async (lat: number, lng: number, placeLabel?: string) => {
    const optimisticQuery: SiteQuery = {
      ...siteQuery,
      lat,
      lng,
      label: placeLabel || `Parcel (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      region: placeLabel ? 'Google Places Selection' : 'Resolving place name...',
    };
    setSiteQuery(optimisticQuery);

    try {
      const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      const geo = await res.json();
      const resolvedQuery: SiteQuery = {
        ...optimisticQuery,
        label: placeLabel || geo.label || optimisticQuery.label,
        region: geo.region || 'Selected Coordinates',
      };
      setSiteQuery(resolvedQuery);
      runAnalysis(resolvedQuery);
    } catch {
      runAnalysis(optimisticQuery);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Geocoding failed');
      setSearchResults(data.results || []);
      if (!data.results?.length) {
        setSearchError('No matching places found. Try a city, district, or landmark name.');
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Unable to search location.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item: GeocodeResult) => {
    const shortLabel = item.displayName.split(',').slice(0, 2).join(', ');
    const next: SiteQuery = {
      ...siteQuery,
      lat: item.lat,
      lng: item.lng,
      label: shortLabel,
      region: item.region,
    };
    setSiteQuery(next);
    setSearchResults([]);
    setSearchInput('');
    runAnalysis(next);
  };

  const handlePinToCompare = () => {
    if (!assessment) return;
    setSavedSites((prev) => {
      if (prev.some((s) => s.id === assessment.id)) return prev;
      return [...prev.slice(-2), assessment];
    });
  };

  const handleSaveToWorkspaceDb = async () => {
    if (!assessment) return;
    if (!authSession?.token) {
      setAuthNotice('Sign in with your verified Supabase or Google account to save dossiers.');
      setShowAuthScreen(true);
      return;
    }

    setIsSavingToDb(true);
    setSaveDbNotice(null);
    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.token}`,
        },
        body: JSON.stringify({
          siteLabel: assessment.telemetry.query.label,
          region: assessment.telemetry.query.region,
          lat: assessment.telemetry.query.lat,
          lng: assessment.telemetry.query.lng,
          projectType: assessment.telemetry.query.projectType,
          areaHectares: assessment.telemetry.query.areaHectares,
          horizonYear: assessment.telemetry.query.horizonYear,
          overallSuitability: assessment.overallSuitability,
          overallVerdict: assessment.overallVerdict,
          netAvoidedInrCr: assessment.costProjection.net25YrAvoidedCostInrCr,
          telemetryJson: JSON.stringify(assessment.telemetry),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save to Cloud SQL.');
      if (data.assessment) {
        setCloudSavedSites((prev) => [data.assessment, ...prev]);
        setSaveDbNotice('Saved to workspace database.');
      }
    } catch (err: any) {
      setSaveDbNotice(err?.message || 'Unable to save assessment.');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const handleLoadCloudRecord = (rec: SavedAssessmentRecord) => {
    try {
      const parsedTelemetry = JSON.parse(rec.telemetryJson) as EnvironmentalTelemetry;
      const evaluated = evaluateSiteTelemetry(parsedTelemetry);
      setSiteQuery(parsedTelemetry.query);
      setAssessment(evaluated);
      setActiveTab('analyzer');
      fetchAiBrief(evaluated);
      fetchSearchGrounding(parsedTelemetry.query);
      fetchMapsGrounding(parsedTelemetry.query);
    } catch {
      const q: SiteQuery = {
        lat: rec.lat,
        lng: rec.lng,
        label: rec.siteLabel,
        region: rec.region,
        projectType: rec.projectType,
        areaHectares: rec.areaHectares,
        horizonYear: rec.horizonYear,
      };
      setSiteQuery(q);
      runAnalysis(q);
    }
  };

  const handleDeleteCloudRecord = async (id: number) => {
    if (!authSession?.token) return;
    try {
      const res = await fetch(`/api/assessments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authSession.token}` },
      });
      if (res.ok) {
        setCloudSavedSites((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      // ignore transient error
    }
  };

  const handleRunAllCorridors = async () => {
    setIsBenchmarkingAll(true);
    try {
      const results = await Promise.all(
        BENCHMARK_CORRIDORS.map(async (c) => {
          const q: SiteQuery = {
            lat: c.lat,
            lng: c.lng,
            label: c.name,
            region: c.city,
            projectType: c.defaultProjectType,
            areaHectares: c.defaultAreaHectares,
            horizonYear: siteQuery.horizonYear,
          };
          const res = await fetch('/api/analyze-site', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(q),
          });
          const telemetry = await res.json();
          if (!res.ok) throw new Error(telemetry.error || 'Benchmark failed');
          return evaluateSiteTelemetry(telemetry);
        })
      );
      setSavedSites(results);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Failed to benchmark all corridors.');
    } finally {
      setIsBenchmarkingAll(false);
    }
  };

  const handleSignOut = async () => {
    if (authSession?.provider === 'supabase') {
      await signOutSupabase();
    } else if (authSession?.provider === 'firebase') {
      await signOutFirebase();
    }
    setAuthSession(null);
    setShowAuthScreen(true);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 text-[#0f2557] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-lime-600 mr-2" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider">
          Initializing TerraSight
        </span>
      </div>
    );
  }

  if (showAuthScreen) {
    return (
      <AuthGate
        initialNotice={authNotice}
        onAuthenticated={() => {
          setAuthNotice(null);
          setShowAuthScreen(false);
        }}
        onContinuePreview={() => {
          setAuthNotice(null);
          setShowAuthScreen(false);
        }}
      />
    );
  }

  const isCurrentPinned = assessment ? savedSites.some((s) => s.id === assessment.id) : false;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract (Navy Blue + White + Lime Green Quote) */}
      <header className="sticky top-0 z-30 bg-[#0f2557] text-white border-b border-blue-950 px-4 sm:px-6 h-14 flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('analyzer');
            }}
            className="flex items-center gap-2 text-base font-display font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="inline-block w-2.5 h-2.5 bg-lime-400" />
            <span>TERRASIGHT</span>
          </a>
          <span className="hidden xl:inline text-xs italic font-medium text-lime-300 border-l border-blue-800 pl-3 whitespace-nowrap">
            “Analyse the future before building one”
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'analyzer', label: 'Site Analyzer' },
              {
                id: 'compare',
                label: savedSites.length > 0 ? `Compare Sites (${savedSites.length})` : 'Compare Sites',
              },
              { id: 'studio', label: 'Concept Studio' },
              { id: 'advisor', label: 'Planning Advisor' },
            ] as Array<{ id: ActiveTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`h-14 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-lime-400 text-lime-300 font-bold'
                  : 'border-transparent text-slate-200 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          {authSession ? (
            <div className="flex items-center gap-2">
              <span className="hidden lg:inline text-xs font-mono text-slate-300 truncate max-w-[150px]">
                {authSession.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                title="Sign out"
                className="px-2.5 py-1.5 text-xs font-semibold text-white hover:text-lime-300 border border-blue-800 bg-blue-950/60 rounded inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 text-lime-400" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthScreen(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white hover:text-lime-300 border border-blue-800 bg-blue-950/60 rounded transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveTab('analyzer');
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            className="px-3.5 py-1.5 text-xs font-bold text-[#0f2557] bg-lime-400 hover:bg-lime-300 rounded transition-colors whitespace-nowrap shrink-0"
          >
            New Assessment
          </button>
        </div>
      </header>

      {/* Quote Strip on Medium / Mobile viewports where xl header quote hides */}
      <div className="xl:hidden bg-lime-50 border-b border-lime-200 px-4 py-1.5 text-center text-xs font-semibold italic text-[#0f2557] print:hidden">
        “Analyse the future before building one”
      </div>

      {/* Tier 1 Google Maps Platform Quota / Auth Warning Banner */}
      {mapsQuotaWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-950 print:hidden">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{mapsQuotaWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setMapsQuotaWarning(null)}
            className="p-1 text-amber-700 hover:text-amber-950"
            aria-label="Dismiss Maps warning"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-white border-b border-slate-200 overflow-x-auto print:hidden">
        {(
          [
            { id: 'analyzer', label: 'Analyzer' },
            { id: 'compare', label: `Compare (${savedSites.length})` },
            { id: 'studio', label: 'Studio' },
            { id: 'advisor', label: 'Advisor' },
          ] as Array<{ id: ActiveTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap shrink-0 ${
              activeTab === tab.id ? 'bg-[#0f2557] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === 'analyzer' && (
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 flex flex-col lg:flex-row gap-6 items-start">
            {/* Left Control & Benchmark Rail */}
            <aside className="w-full lg:w-[320px] shrink-0 space-y-5">
              {/* Location Search */}
              <section className="bg-white border border-slate-200 rounded p-4 space-y-3">
                <div>
                  <h2 className="text-sm font-display font-bold text-[#0f2557]">
                    Location Search
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Search any city, corridor, or click the Google satellite map
                  </p>
                </div>

                <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="e.g., Noida, Pune, Surat..."
                      className="w-full pl-8 pr-2.5 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded focus:outline-none focus:border-[#0f2557]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching}
                    className="px-3 py-2 text-xs font-bold bg-[#0f2557] text-white rounded hover:bg-[#163375] disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    {isSearching ? '...' : 'Find'}
                  </button>
                </form>

                {searchError && <p className="text-xs text-amber-700">{searchError}</p>}

                {searchResults.length > 0 && (
                  <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-48 overflow-y-auto bg-white">
                    {searchResults.map((res, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectSearchResult(res)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-lime-50 transition-colors"
                      >
                        <div className="font-semibold text-[#0f2557] truncate">
                          {res.displayName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {res.lat.toFixed(4)}, {res.lng.toFixed(4)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Indian Urban Corridor Benchmarks */}
              <section className="bg-white border border-slate-200 rounded p-4 space-y-3">
                <div>
                  <h2 className="text-sm font-display font-bold text-[#0f2557]">
                    Indian Urban Corridors
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select a benchmark growth zone to inspect
                  </p>
                </div>

                <div className="space-y-2.5">
                  {BENCHMARK_CORRIDORS.map((corridor) => {
                    const isSelected =
                      Math.abs(siteQuery.lat - corridor.lat) < 0.005 &&
                      Math.abs(siteQuery.lng - corridor.lng) < 0.005;
                    return (
                      <button
                        key={corridor.id}
                        type="button"
                        onClick={() => handleSelectBenchmark(corridor)}
                        className={`w-full text-left rounded border overflow-hidden transition-colors ${
                          isSelected
                            ? 'border-lime-600 bg-lime-50/70'
                            : 'border-slate-200 bg-white hover:border-[#0f2557]'
                        }`}
                      >
                        <div className="flex gap-3 p-2.5 items-center">
                          <img
                            src={corridor.previewImage}
                            alt={corridor.city}
                            referrerPolicy="no-referrer"
                            className="w-16 h-12 rounded-sm object-cover shrink-0 bg-slate-100"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[#0f2557] truncate">
                              {corridor.city}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {corridor.corridor}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Proposed Project Parameters */}
              <section className="bg-white border border-slate-200 rounded p-4 space-y-4">
                <h2 className="text-sm font-display font-bold text-[#0f2557]">
                  Proposed Development
                </h2>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Project Typology
                  </label>
                  <div className="space-y-1.5">
                    {(Object.keys(PROJECT_LABELS) as ProjectType[]).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => handleProjectConfigChange({ projectType: pt })}
                        className={`w-full text-left px-3 py-2 text-xs font-semibold rounded border transition-colors ${
                          siteQuery.projectType === pt
                            ? 'border-lime-600 bg-lime-50 text-[#0f2557]'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {PROJECT_LABELS[pt]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor="area-slider" className="font-semibold text-slate-600">
                      Site Footprint
                    </label>
                    <span className="font-mono tabular-nums font-bold text-[#0f2557]">
                      {siteQuery.areaHectares} ha
                    </span>
                  </div>
                  <input
                    id="area-slider"
                    type="range"
                    min={10}
                    max={150}
                    step={5}
                    value={siteQuery.areaHectares}
                    onChange={(e) =>
                      handleProjectConfigChange({ areaHectares: Number(e.target.value) })
                    }
                    className="w-full accent-lime-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Climate Horizon
                  </label>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded">
                    {([2035, 2050] as HorizonYear[]).map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => handleProjectConfigChange({ horizonYear: yr })}
                        className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-sm transition-colors ${
                          siteQuery.horizonYear === yr
                            ? 'bg-[#0f2557] text-white'
                            : 'text-slate-600 hover:text-[#0f2557]'
                        }`}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => runAnalysis(siteQuery)}
                  disabled={isAnalyzing}
                  className="w-full py-2.5 px-4 bg-lime-600 hover:bg-lime-700 disabled:opacity-60 text-white text-xs font-bold rounded transition-colors flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Querying Public Datasets...
                    </>
                  ) : (
                    'Refresh Site Telemetry'
                  )}
                </button>
              </section>

              {/* Offline Field Cache (Workbox CacheStorage) */}
              {cachedSites.length > 0 && (
                <section className="bg-white border border-slate-200 rounded p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-display font-bold text-[#0f2557] flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-lime-600" />
                      Offline Field Cache
                    </h2>
                    <span className="text-[11px] font-mono font-semibold text-lime-700">
                      {cachedSites.length} ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Recent telemetry cached by Workbox for low-signal field visits.
                  </p>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {cachedSites.slice(0, 8).map((item: CachedFieldSiteSummary) => (
                      <button
                        key={item.cacheUrl}
                        type="button"
                        onClick={() => {
                          const next: SiteQuery = {
                            lat: item.lat,
                            lng: item.lng,
                            label: item.label,
                            region: item.region,
                            projectType: item.projectType,
                            areaHectares: item.areaHectares,
                            horizonYear: item.horizonYear,
                          };
                          setSiteQuery(next);
                          runAnalysis(next);
                        }}
                        className="w-full text-left px-2.5 py-2 bg-slate-50 hover:bg-lime-50 border border-slate-200 hover:border-lime-500 rounded transition-colors"
                      >
                        <div className="text-xs font-bold text-[#0f2557] truncate">
                          {item.label}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                          {item.region} · {item.horizonYear} · {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Saved Workspace Assessments (Cloud SQL) */}
              {authSession && (
                <section className="bg-white border border-slate-200 rounded p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-display font-bold text-[#0f2557] flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-lime-600" />
                      Saved Dossiers
                    </h2>
                    <span className="text-[11px] font-mono text-slate-400">
                      {cloudSavedSites.length}
                    </span>
                  </div>

                  {cloudSavedSites.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Save an evaluated site to persist its telemetry in your workspace.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {cloudSavedSites.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded flex items-start justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleLoadCloudRecord(rec)}
                            className="text-left min-w-0 flex-1"
                          >
                            <div className="text-xs font-semibold text-[#0f2557] truncate hover:text-lime-700">
                              {rec.siteLabel}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                              {rec.overallSuitability}/100 · {rec.horizonYear} · ₹
                              {rec.netAvoidedInrCr.toFixed(1)} Cr
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCloudRecord(rec.id)}
                            aria-label={`Delete ${rec.siteLabel}`}
                            className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </aside>

            {/* Primary Geospatial & Evaluation Stage */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* Active Site Header & Workspace Toolbar */}
              <div className="bg-white border border-slate-200 rounded p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-bold text-[#0f2557]">
                      <MapPin className="w-3.5 h-3.5 text-lime-600" />
                      {siteQuery.region}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700">
                      {PROJECT_LABELS[siteQuery.projectType]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{siteQuery.areaHectares} ha</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Horizon {siteQuery.horizonYear}</span>
                    {(cachedTelemetryAt || !isOnline) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-lime-100 text-[#0f2557] border border-lime-400 rounded">
                          Cached Telemetry
                          {cachedTelemetryAt
                            ? ` (${new Date(cachedTelemetryAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })})`
                            : ''}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-display font-extrabold text-[#0f2557] tracking-tight mt-1 truncate">
                    {siteQuery.label}
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {assessment && (
                    <div className="pr-3 mr-1 border-r border-slate-200 text-right">
                      <div className="text-[11px] text-slate-500">Suitability</div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-mono tabular-nums font-extrabold text-[#0f2557]">
                          {assessment.overallSuitability}/100
                        </span>
                        <VerdictBadge level={assessment.overallVerdict} />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveToWorkspaceDb}
                    disabled={!assessment || isSavingToDb}
                    className="px-3 py-2 text-xs font-semibold border border-slate-200 bg-white hover:border-lime-600 disabled:opacity-60 text-[#0f2557] rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {isSavingToDb ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-lime-600" />
                    ) : (
                      <BookmarkCheck className="w-3.5 h-3.5 text-lime-600" />
                    )}
                    {authSession ? 'Save Dossier' : 'Sign In to Save'}
                  </button>

                  <button
                    type="button"
                    onClick={handlePinToCompare}
                    disabled={!assessment || isCurrentPinned}
                    className="px-3 py-2 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-[#0f2557] rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    {isCurrentPinned ? 'Pinned' : 'Pin to Compare'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('studio')}
                    className="px-3 py-2 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-[#0f2557] rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-lime-600" />
                    Render Concept
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawerOpen((v) => !v)}
                    className={`px-3 py-2 text-xs font-semibold border rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      drawerOpen
                        ? 'border-lime-600 bg-lime-50 text-[#0f2557]'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-[#0f2557]'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Advisor Chat
                  </button>
                </div>
              </div>

              {saveDbNotice && (
                <div className="px-3.5 py-2 bg-lime-50 border border-lime-300 rounded text-xs text-[#1a2e05] flex items-center justify-between">
                  <span>{saveDbNotice}</span>
                  <button
                    type="button"
                    onClick={() => setSaveDbNotice(null)}
                    className="text-slate-500 hover:text-[#0f2557]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {analysisError && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-xs text-amber-950 flex items-center justify-between gap-3">
                  <span>{analysisError}</span>
                  <button
                    type="button"
                    onClick={() => runAnalysis(siteQuery)}
                    className="px-3 py-1.5 bg-[#0f2557] text-white font-semibold rounded"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Google Maps Platform Satellite Viewport */}
              <SatelliteMap
                lat={siteQuery.lat}
                lng={siteQuery.lng}
                label={siteQuery.label}
                layerMode={layerMode}
                showElevationGrid={showElevationGrid}
                showLandUseBuffer={showLandUseBuffer}
                elevationGrid={assessment?.telemetry.elevation.grid ?? []}
                landUseSamples={assessment?.telemetry.landUse2Km.sampleFeatures ?? []}
                onSelectCoordinates={handleMapClick}
                onLayerChange={setLayerMode}
                onToggleElevationGrid={() => setShowElevationGrid((v) => !v)}
                onToggleLandUseBuffer={() => setShowLandUseBuffer((v) => !v)}
              />

              {/* Public Data Source Verification Line */}
              {assessment && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 px-1">
                  <span className="font-bold text-[#0f2557]">Verified Public Feeds:</span>
                  {assessment.telemetry.sources.map((src) => (
                    <span key={src.name} className="inline-flex items-center gap-1">
                      {src.ok ? (
                        <CheckCircle2 className="w-3 h-3 text-lime-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                      )}
                      <span className="text-slate-800 font-medium">{src.name}</span>
                      <span className="text-slate-400 font-mono text-[11px]">({src.detail})</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Five-Pillar Site Intelligence Grid */}
              {isAnalyzing && !assessment ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div
                      key={n}
                      className="h-44 bg-white border border-slate-200 rounded p-4 animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                assessment && (
                  <>
                    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                      {assessment.pillars.map((pillar) => (
                        <div
                          key={pillar.id}
                          className="bg-white border border-slate-200 rounded p-4 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-xs font-display font-bold text-[#0f2557] inline-flex items-center gap-1">
                                <span>{pillar.title}</span>
                                {PILLAR_HELP[pillar.id] && (
                                  <MetricHelpTooltip
                                    title={pillar.title}
                                    explanation={PILLAR_HELP[pillar.id].explanation}
                                    budgetImpact={PILLAR_HELP[pillar.id].budgetImpact}
                                  />
                                )}
                              </h3>
                              <VerdictBadge level={pillar.riskLevel} />
                            </div>
                            <div className="mt-3 flex items-baseline gap-1.5">
                              <span className="text-2xl font-mono tabular-nums font-extrabold text-[#0f2557]">
                                {pillar.headlineMetric}
                              </span>
                              <span className="text-xs font-mono text-slate-500">
                                {pillar.headlineUnit}
                              </span>
                            </div>
                            <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                              {pillar.subMetric}
                            </div>
                          </div>

                          <ul className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
                            {pillar.findings.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </section>

                    {/* Climate Trajectory & Radar Visualization */}
                    <ClimateCharts
                      monthlySeries={assessment.telemetry.climate.monthlySeries}
                      horizonYear={assessment.telemetry.query.horizonYear}
                      pillars={assessment.pillars}
                    />

                    {/* 25-Year Preventive Cost Avoidance Breakdown */}
                    <section className="bg-white border border-slate-200 rounded p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                        <div>
                          <h2 className="text-base font-display font-extrabold text-[#0f2557]">
                            25-Year Lifecycle Cost &amp; Preventive Savings Model
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Engineering cost multipliers anchored to live CMIP6 warming, GloFAS hydrology, CAMS PM2.5, and terrain relief.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                          <div>
                            <span className="text-slate-500 block text-[11px] font-sans">
                              Baseline CapEx
                            </span>
                            <span className="font-bold text-[#0f2557]">
                              ₹{assessment.costProjection.baselineCapexInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px] font-sans">
                              Unmitigated Penalty
                            </span>
                            <span className="font-bold text-rose-700">
                              ₹{assessment.costProjection.unmitigated25YrPenaltyInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px] font-sans">
                              Preventive Upfront
                            </span>
                            <span className="font-bold text-[#0f2557]">
                              ₹{assessment.costProjection.preventiveGreenCapexInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px] font-sans">
                              Net 25-Yr Avoided Cost
                            </span>
                            <span className="font-extrabold text-lime-700">
                              ₹{assessment.costProjection.net25YrAvoidedCostInrCr.toFixed(1)} Cr (
                              {assessment.costProjection.roiMultiple.toFixed(1)}× ROI)
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="overflow-x-auto border border-slate-200 rounded">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#0f2557] text-white border-b border-slate-200">
                              <th className="py-2.5 px-3.5 font-bold">Cost Driver</th>
                              <th className="py-2.5 px-3.5 font-bold">Empirical Telemetry Basis</th>
                              <th className="py-2.5 px-3.5 font-bold text-right">
                                Unmitigated (₹ Cr)
                              </th>
                              <th className="py-2.5 px-3.5 font-bold text-right">
                                With Early Design (₹ Cr)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {assessment.costProjection.assumptions.map((row) => (
                              <tr key={row.driver} className="hover:bg-slate-50">
                                <td className="py-2.5 px-3.5 font-semibold text-[#0f2557]">
                                  {row.driver}
                                </td>
                                <td className="py-2.5 px-3.5 text-slate-600">{row.formulaNote}</td>
                                <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-rose-700 font-semibold">
                                  ₹{row.unmitigatedInrCr.toFixed(1)}
                                </td>
                                <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-lime-700 font-bold">
                                  ₹{row.mitigatedInrCr.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* AI Preventive Synthesis & Alternative Corridors */}
                    <section className="bg-white border border-slate-200 rounded p-5 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <h2 className="text-base font-display font-extrabold text-[#0f2557]">
                            Preventive Planning Brief &amp; Alternative Siting
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Synthesized strictly from measured satellite and environmental telemetry via Gemini 4 Hydrogen
                          </p>
                        </div>
                        {isGeneratingBrief && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#0f2557] font-semibold">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-lime-600" /> Synthesizing field brief...
                          </span>
                        )}
                      </div>

                      {briefError && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-950 flex items-center justify-between gap-2">
                          <span>{briefError}</span>
                          <button
                            type="button"
                            onClick={() => fetchAiBrief(assessment)}
                            className="px-2.5 py-1 bg-[#0f2557] text-white rounded text-xs font-semibold shrink-0"
                          >
                            Retry Brief
                          </button>
                        </div>
                      )}

                      {aiBrief && (
                        <div className="space-y-6">
                          <p className="text-sm text-slate-800 leading-relaxed max-w-4xl">
                            {aiBrief.executiveSummary}
                          </p>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Hazards */}
                            <div className="space-y-3">
                              <h3 className="text-xs font-display font-bold text-[#0f2557]">
                                Identified Future Constraints
                              </h3>
                              <div className="space-y-2.5">
                                {aiBrief.keyHazards.map((h, i) => (
                                  <div
                                    key={i}
                                    className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-[#0f2557]">
                                        {h.title}
                                      </span>
                                      <span className="text-[11px] font-mono font-bold text-amber-700">
                                        {h.severity}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-600">{h.evidence}</p>
                                    <p className="text-xs text-slate-900 font-medium">
                                      {h.consequence}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Preventive Mitigations */}
                            <div className="space-y-3">
                              <h3 className="text-xs font-display font-bold text-[#0f2557]">
                                Preventive Pre-Construction Modifications
                              </h3>
                              <div className="space-y-2.5">
                                {aiBrief.mitigationStrategies.map((m, i) => (
                                  <div
                                    key={i}
                                    className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-[#0f2557]">
                                        {m.title}
                                      </span>
                                      <span className="text-[11px] font-mono font-bold text-lime-700">
                                        {m.costCategory}
                                      </span>
                                    </div>
                                    <p className="text-xs text-lime-800 font-semibold">{m.impact}</p>
                                    <p className="text-xs text-slate-600">{m.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Alternative Siting Recommendations */}
                          {aiBrief.alternativeCorridors?.length > 0 && (
                            <div className="pt-4 border-t border-slate-100 space-y-3">
                              <h3 className="text-xs font-display font-bold text-[#0f2557]">
                                Alternative Relocation Candidates (Click to Evaluate Live)
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {aiBrief.alternativeCorridors.map((alt, i) => {
                                  const targetLat = +(
                                    siteQuery.lat +
                                    Math.max(-0.2, Math.min(0.2, Number(alt.latOffset) || 0.06))
                                  ).toFixed(4);
                                  const targetLng = +(
                                    siteQuery.lng +
                                    Math.max(-0.2, Math.min(0.2, Number(alt.lngOffset) || 0.06))
                                  ).toFixed(4);
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => handleMapClick(targetLat, targetLng)}
                                      className="text-left p-3.5 bg-slate-50 border border-slate-200 hover:border-lime-600 hover:bg-lime-50/50 rounded transition-colors flex items-start justify-between gap-3"
                                    >
                                      <div>
                                        <div className="text-xs font-bold text-[#0f2557] flex items-center gap-1.5">
                                          <Compass className="w-3.5 h-3.5 text-lime-600" />
                                          {alt.name}
                                        </div>
                                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                          {alt.directionAndDistance} · {targetLat}°, {targetLng}°
                                        </div>
                                        <p className="text-xs text-slate-600 mt-1.5">
                                          {alt.rationale}
                                        </p>
                                      </div>
                                      <ArrowUpRight className="w-4 h-4 text-[#0f2557] shrink-0 mt-0.5" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </section>

                    {/* Google Search Grounding + Google Maps Grounding Context */}
                    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Live Web Advisories (Google Search Grounding) */}
                      <div className="bg-white border border-slate-200 rounded p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-lime-600 shrink-0" />
                            <div>
                              <h3 className="text-xs font-display font-bold text-[#0f2557]">
                                Live Web &amp; Regulatory Advisories
                              </h3>
                              <p className="text-[11px] text-slate-500">
                                Grounded via Google Search
                              </p>
                            </div>
                          </div>
                          {isSearchGroundingLoading && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-lime-600" />
                          )}
                        </div>

                        {searchGroundingError && (
                          <div className="text-xs text-amber-800 flex items-center justify-between gap-2">
                            <span>{searchGroundingError}</span>
                            <button
                              type="button"
                              onClick={() => fetchSearchGrounding(siteQuery)}
                              className="px-2 py-1 bg-[#0f2557] text-white rounded text-xs font-semibold"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {searchGrounding && (
                          <div className="space-y-3">
                            <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                              {searchGrounding.summary}
                            </div>
                            {searchGrounding.sources.length > 0 && (
                              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                                <div className="text-[11px] font-mono font-bold text-[#0f2557] uppercase">
                                  Referenced Sources
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {searchGrounding.sources.map((src, idx) => (
                                    <a
                                      key={idx}
                                      href={src.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-slate-50 border border-slate-200 hover:border-lime-600 text-[#0f2557] rounded transition-colors"
                                    >
                                      <span className="truncate max-w-[190px]">{src.title}</span>
                                      <ExternalLink className="w-3 h-3 text-lime-600 shrink-0" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Surrounding Civic & Ecological Landmarks (Google Maps Grounding) */}
                      <div className="bg-white border border-slate-200 rounded p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-lime-600 shrink-0" />
                            <div>
                              <h3 className="text-xs font-display font-bold text-[#0f2557]">
                                Nearby Infrastructure &amp; Landmarks
                              </h3>
                              <p className="text-[11px] text-slate-500">
                                Grounded via Google Maps Places Context
                              </p>
                            </div>
                          </div>
                          {isMapsGroundingLoading && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-lime-600" />
                          )}
                        </div>

                        {mapsGroundingError && (
                          <div className="text-xs text-amber-800 flex items-center justify-between gap-2">
                            <span>{mapsGroundingError}</span>
                            <button
                              type="button"
                              onClick={() => fetchMapsGrounding(siteQuery)}
                              className="px-2 py-1 bg-[#0f2557] text-white rounded text-xs font-semibold"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {mapsGrounding && (
                          <div className="space-y-3">
                            <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                              {mapsGrounding.summary}
                            </div>
                            {mapsGrounding.places.length > 0 && (
                              <div className="pt-2 border-t border-slate-100 space-y-2">
                                <div className="text-[11px] font-mono font-bold text-[#0f2557] uppercase">
                                  Google Maps Referenced Places
                                </div>
                                <div className="space-y-1.5">
                                  {mapsGrounding.places.map((pl, idx) => (
                                    <div
                                      key={idx}
                                      className="p-2 bg-slate-50 border border-slate-200 rounded"
                                    >
                                      <a
                                        href={pl.uri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0f2557] hover:text-lime-700"
                                      >
                                        <span>{pl.title}</span>
                                        <ExternalLink className="w-3 h-3 text-lime-600 shrink-0" />
                                      </a>
                                      {pl.snippets[0] && (
                                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                                          {pl.snippets[0]}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )
              )}
            </div>
          </div>
        )}

        {activeTab === 'compare' && (
          <CompareView
            savedSites={savedSites}
            activeAssessment={assessment}
            isBenchmarkingAll={isBenchmarkingAll}
            onRunAllCorridors={handleRunAllCorridors}
            onSelectSite={(site) => {
              setSiteQuery(site.telemetry.query);
              setAssessment(site);
              setActiveTab('analyzer');
              fetchAiBrief(site);
              fetchSearchGrounding(site.telemetry.query);
              fetchMapsGrounding(site.telemetry.query);
            }}
            onRemoveSite={(id) => setSavedSites((prev) => prev.filter((s) => s.id !== id))}
            onSitesChange={setSavedSites}
          />
        )}

        {activeTab === 'studio' && (
          <ConceptStudio
            assessment={assessment}
            concepts={concepts}
            onConceptCreated={(c) => setConcepts((prev) => [c, ...prev])}
          />
        )}

        {activeTab === 'advisor' && (
          <PlanningAdvisor
            assessment={assessment}
            messages={chatMessages}
            selectedModel={chatModel}
            onModelChange={setChatModel}
            onMessagesChange={setChatMessages}
          />
        )}
      </main>

      {/* Slide-Over Advisor Drawer inside Analyzer / Compare / Studio */}
      {drawerOpen && activeTab !== 'advisor' && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-[#0f2557] text-white">
            <span className="text-xs font-display font-bold">
              Site Intelligence Advisor Drawer
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1 text-slate-300 hover:text-white rounded"
              aria-label="Close advisor drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 p-2">
            <PlanningAdvisor
              assessment={assessment}
              messages={chatMessages}
              selectedModel={chatModel}
              onModelChange={setChatModel}
              onMessagesChange={setChatMessages}
              compact
            />
          </div>
        </div>
      )}

      {/* Offline Connectivity Banner for Field Inspectors */}
      <OfflineIndicator cachedSiteCount={cachedSites.length} />

      {/* Floating Right-Corner 10-Year Future & Live Web AI */}
      <CornerFutureAI siteQuery={siteQuery} assessment={assessment} />

      {/* Clean Minimal Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 py-4 mt-8">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-semibold text-[#0f2557]">
            TerraSight — “Analyse the future before building one”
          </span>
          <span>
            Sources: Google Maps Platform, Open-Meteo CMIP6, Copernicus DEM 90m, CAMS Air, GloFAS, NASA POWER, OpenStreetMap
          </span>
        </div>
      </footer>
    </div>
  );
}
