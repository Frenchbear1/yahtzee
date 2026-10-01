'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6,
  Cloud, Dices, Flag, History, Home as HomeIcon, House, Layers, LogIn, LogOut,
  Play, Plus, Share2, Sparkles, Star, Trash2, TrendingUp, Trophy, UserPlus, X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toaster, toast } from 'sonner';
import { bonusPlans, categories, gameHasMoves, leaderboard, totals, type Category, type Game, type Sheet, type State } from '@/lib/game';
import { browserGameRequest } from '@/lib/browser-game';
import { firebaseGameRequest } from '@/lib/firebase-game';
import { getGoogleIdToken, loadGoogleScores, signInWithGoogle, signOutGoogle, watchGoogleAccount, type GoogleAccount } from '@/lib/firebase-profile';

const icons = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Layers, Layers, House, TrendingUp, ArrowUpRight, Star, Dices];
const yahtzeeCategory = categories.find(category => category.id === 'yahtzee')!;
const fmtTime = (value: number) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (value: number) => new Date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'You';

function Count({ value, duration = 650, format = value => String(value) }: { value: number; duration?: number; format?: (value: number) => string }) {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const adjustedDuration = Math.min(950, Math.max(420, duration + Math.abs(value - from) * 2));
    function tick(time: number) {
      const progress = Math.min((time - start) / adjustedDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 5);
      const next = Math.round(from + (value - from) * eased);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span className="number-ticker">{format(display)}</span>;
}

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const initials = name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar"><span>{initials}</span>{photoUrl && <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}

function Empty({ kind, title, body, action }: { kind: 'history' | 'trophy'; title: string; body: string; action?: React.ReactNode }) {
  const Icon = kind === 'history' ? History : Trophy;
  return <div className="empty-card"><Icon size={35} strokeWidth={1.4} /><h2>{title}</h2><p>{body}</p>{action}</div>;
}

type OptimisticMutation = { id: number; body: Record<string, unknown>; gameId: string; apply: (state: State) => State };
type View = 'home' | 'game';

export default function Home() {
  const pagesBuild = typeof window !== 'undefined' && window.__YAHTZEE_PAGES__ === true;
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountError, setAccountError] = useState('');
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('home');
  const [homeTab, setHomeTab] = useState<'home' | 'leaderboard' | 'history'>('home');
  const [category, setCategory] = useState<Category | null>(null);
  const [numeric, setNumeric] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [modal, setModal] = useState<'invite' | 'profile' | 'new' | 'finish' | null>(null);
  const [profileName, setProfileName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [bonusPlanIndex, setBonusPlanIndex] = useState(-1);
  const [celebrating, setCelebrating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [savingCount, setSavingCount] = useState(0);
  const [googleUser, setGoogleUser] = useState<GoogleAccount | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const token = useRef('');
  const googleUserRef = useRef<GoogleAccount | null>(null);
  const snapshot = useRef<State | null>(null);
  const busyRef = useRef(false);
  const apiQueue = useRef<Promise<State | null>>(Promise.resolve(null));
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingMutations = useRef<OptimisticMutation[]>([]);
  const mutationId = useRef(0);
  const initialViewChosen = useRef(false);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const me = state?.me;
  const game = state?.game;
  const sheet = game?.sheets.find(item => item.player_id === me?.id);
  const score = totals(sheet?.scores, sheet?.bonus);
  const host = state?.room.host_id === me?.id;
  const browserMode = state?.mode === 'browser' || (pagesBuild && state?.mode !== 'online');
  const lanMode = state?.mode === 'lan';
  const plans = useMemo(() => bonusPlans(sheet?.scores || {}, 3), [sheet?.scores]);
  const activePlan = bonusPlanIndex >= 0 && plans.length ? plans[bonusPlanIndex % plans.length] : null;
  const bonusNeeded = Math.max(0, 63 - score.upper);
  const maxRemainingUpper = categories.slice(0, 6).reduce((sum, item) => {
    if (sheet?.scores[item.id] !== null && sheet?.scores[item.id] !== undefined) return sum;
    return sum + ('face' in item ? item.face * 5 : 0);
  }, 0);
  const headerName = firstName(googleUser?.displayName || me?.name || 'You');
  const profilePhoto = googleUser?.photoURL || me?.photo_url || null;

  const celebrate = useCallback(() => {
    setCelebrating(false);
    requestAnimationFrame(() => setCelebrating(true));
    if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    celebrateTimer.current = setTimeout(() => setCelebrating(false), 2700);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([50, 50, 80]);
  }, []);

  const requestState = useCallback(async (data: Record<string, unknown>, playerToken = token.current): Promise<State> => {
    if (typeof window !== 'undefined' && window.__YAHTZEE_PAGES__) {
      const user = googleUserRef.current;
      return user ? firebaseGameRequest(data, user) : browserGameRequest(data);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let googleToken = '';
      try { if (googleUserRef.current) googleToken = await getGoogleIdToken(googleUserRef.current); } catch {}
      const response = await fetch('/api/game', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-player-token': playerToken, ...(googleToken ? { Authorization: `Bearer ${googleToken}` } : {}) },
        body: JSON.stringify(data),
      });
      const next = await response.json() as State & { error?: string };
      if (!response.ok) {
        const failure = new Error(next.error || 'Your score could not be saved. Try again.') as Error & { status?: number };
        failure.status = response.status;
        throw failure;
      }
      return next;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const applyServerState = useCallback((next: State) => {
    const current = snapshot.current;
    if (current?.game?.id === next.game?.id) {
      const currentRevision = current.game.sheets.find(item => item.player_id === current.me.id)?.revision ?? -1;
      const nextRevision = next.game.sheets.find(item => item.player_id === next.me.id)?.revision ?? -1;
      if (nextRevision < currentRevision) return;
    }
    snapshot.current = next;
    const display = pendingMutations.current.reduce((current, mutation) => mutation.apply(current), next);
    setState(display);
    setError('');
    setReady(true);
    try { localStorage.setItem('yahtzee-state-cache', JSON.stringify({ token: token.current, state: next })); } catch {}
  }, []);

  const api = useCallback((data: Record<string, unknown>, quiet = false): Promise<State | null> => {
    if (!token.current) return Promise.resolve(null);
    const run = async () => {
      if (quiet && (busyRef.current || pendingMutations.current.length)) return null;
      if (!quiet) { busyRef.current = true; setBusy(true); }
      try {
        const playerToken = token.current;
        const next = await requestState(data, playerToken);
        if (playerToken === token.current) {
          applyServerState(next);
        }
        return next;
      } catch (caught) {
        const failure = caught as Error & { status?: number };
        if (failure.status === 409) setTimeout(() => { void refreshRef.current(); }, 100);
        const message = failure.name !== 'AbortError' ? failure.message : 'Connection lost. Your input is still here. Please try again.';
        if (message.startsWith('Google sign-in')) setAccountError(message);
        else setError(message);
        setReady(true);
        return null;
      } finally {
        if (!quiet) { busyRef.current = false; setBusy(false); }
      }
    };
    if (quiet) return run();
    const queued = apiQueue.current.then(run, run);
    apiQueue.current = queued;
    return queued;
  }, [applyServerState, requestState]);

  const refreshRef = useRef<() => Promise<unknown>>(async () => {});
  refreshRef.current = () => api({ action: 'refresh' }, true);

  async function persistMutation(mutation: OptimisticMutation) {
    try {
      const authoritative = snapshot.current;
      if (!authoritative) throw new Error('Your score sheet needs to reconnect.');
      const authoritativeGame = authoritative?.history.find(item => item.id === mutation.gameId);
      const authoritativeSheet = authoritativeGame?.sheets.find(item => item.player_id === authoritative.me.id);
      if (!authoritativeSheet) throw new Error('Your score sheet needs to reconnect.');
      const next = await requestState({ ...mutation.body, gameId: mutation.gameId, revision: authoritativeSheet.revision });
      pendingMutations.current = pendingMutations.current.filter(item => item.id !== mutation.id);
      setSavingCount(pendingMutations.current.length);
      applyServerState(next);
    } catch (caught) {
      pendingMutations.current = pendingMutations.current.filter(item => item.id !== mutation.id);
      setSavingCount(pendingMutations.current.length);
      if (snapshot.current) applyServerState(snapshot.current);
      const failure = caught as Error & { status?: number };
      setError(failure.name !== 'AbortError' ? failure.message : 'Connection lost. That score was not saved.');
      if (failure.status === 409) setTimeout(() => { void refreshRef.current(); }, 100);
    }
  }

  function enqueueMutation(mutation: Omit<OptimisticMutation, 'id'>) {
    const queued = { ...mutation, id: ++mutationId.current };
    pendingMutations.current = [...pendingMutations.current, queued];
    setSavingCount(pendingMutations.current.length);
    setState(current => current ? queued.apply(current) : current);
    mutationQueue.current = mutationQueue.current.then(() => persistMutation(queued), () => persistMutation(queued));
  }

  useEffect(() => {
    try {
      let saved = localStorage.getItem('yahtzee-player-key');
      if (!saved) {
        saved = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('yahtzee-player-key', saved);
      }
      token.current = saved;
      const cached = localStorage.getItem('yahtzee-state-cache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { token?: string; state?: State };
          if (parsed.token === saved && parsed.state?.room && parsed.state?.game) {
            snapshot.current = parsed.state;
            setState(parsed.state);
            setReady(true);
          }
        } catch { localStorage.removeItem('yahtzee-state-cache'); }
      }
    } catch {
      setError('Allow browser storage so this device can remember your player.');
      setReady(true);
      return;
    }
    const tableCode = new URLSearchParams(window.location.search).get('table');
    if (tableCode) { setJoinCode(tableCode); setModal('invite'); }
    void api({ action: 'bootstrap' });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void api({ action: 'refresh' }, true); }, 4000);
    const reconnect = () => void api({ action: 'bootstrap' }, true);
    window.addEventListener('online', reconnect);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', reconnect);
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    };
  }, [api]);

  useEffect(() => {
    if (lanMode) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void watchGoogleAccount(async user => {
      if (stopped) return;
      googleUserRef.current = user;
      setGoogleUser(user);
      if (!user) {
        setAccountError('');
        if (pagesBuild) await api({ action: 'bootstrap' });
        return;
      }
      try {
        setAuthBusy(true);
        await getGoogleIdToken(user);
        const linkedCode = pagesBuild ? new URLSearchParams(window.location.search).get('table') : null;
        const legacyState = pagesBuild && !linkedCode ? await loadGoogleScores(user.uid) : null;
        const next = await api(linkedCode ? { action: 'join-room', code: linkedCode } : { action: 'bootstrap', legacyState });
        if (next) await api({ action: 'sync-profile', name: user.displayName || 'Player', photoUrl: user.photoURL });
        if (next && linkedCode) {
          const url = new URL(window.location.href);
          url.searchParams.delete('table');
          window.history.replaceState({}, '', url);
          setJoinCode('');
          setModal(null);
          toast.success('You joined the game.');
        }
        setAccountError('');
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : 'Google sign-in could not finish.');
      } finally {
        setAuthBusy(false);
      }
    }).then(stop => { unsubscribe = stop; }).catch(caught => setAccountError(caught instanceof Error ? caught.message : 'Google sign-in could not load.'));
    return () => { stopped = true; unsubscribe?.(); };
  }, [api, lanMode, pagesBuild]);

  useEffect(() => {
    if (modal !== 'finish') return;
    setPhase(0);
    const timers = [600, 1200, 1900, 2500].map((ms, index) => setTimeout(() => {
      setPhase(index + 1);
      if (index === 3) celebrate();
    }, ms));
    return () => timers.forEach(clearTimeout);
  }, [modal, celebrate]);

  useEffect(() => {
    if (game?.id) {
      setCategory(null);
      setOpenOnly(false);
      setBonusPlanIndex(-1);
    }
  }, [game?.id]);
  useEffect(() => { setBonusPlanIndex(-1); }, [sheet?.revision]);

  useEffect(() => {
    if (initialViewChosen.current || !ready || !game || !sheet) return;
    initialViewChosen.current = true;
    if (!game.ended_at && totals(sheet.scores, sheet.bonus).filled > 0 && !sheet.completed_at) setView('game');
  }, [game, ready, sheet]);

  function saveScore(chosen: Category, value: number | null) {
    if (!game || !sheet || !state) return;
    if (chosen.id === 'yahtzee' && value === 50 && sheet.scores.yahtzee === 50) {
      setCategory(null); setNumeric(''); changeBonus(sheet.bonus + 1); return;
    }
    const oldValue = sheet.scores[chosen.id] ?? null, before = score.filled;
    const nextBonus = chosen.id === 'yahtzee' ? (value === 50 ? sheet.bonus : 0) : sheet.bonus;
    const apply = (current: State) => {
      const updateGame = (item: Game): Game => item.id !== game.id ? item : {
        ...item,
        sheets: item.sheets.map(playerSheet => playerSheet.player_id === current.me.id ? { ...playerSheet, scores: { ...playerSheet.scores, [chosen.id]: value }, bonus: nextBonus } : playerSheet),
      };
      return { ...current, game: updateGame(current.game), history: current.history.map(updateGame) };
    };
    setCategory(null);
    setNumeric('');
    enqueueMutation({ body: { action: 'score', category: chosen.id, value }, gameId: game.id, apply });
    const afterScores = { ...sheet.scores, [chosen.id]: value };
    if (before < 13 && totals(afterScores, nextBonus).filled === 13) { setView('home'); setHomeTab('home'); setModal('finish'); }
    else if (chosen.id === 'yahtzee' && value === 50 && oldValue !== 50) celebrate();
  }

  function changeBonus(nextBonus: number) {
    if (!sheet || !game || !state || nextBonus < 0 || nextBonus > 12) return;
    const oldBonus = sheet.bonus;
    const apply = (current: State) => {
      const updateGame = (item: Game): Game => item.id !== game.id ? item : {
        ...item,
        sheets: item.sheets.map(playerSheet => playerSheet.player_id === current.me.id ? { ...playerSheet, bonus: nextBonus } : playerSheet),
      };
      return { ...current, game: updateGame(current.game), history: current.history.map(updateGame) };
    };
    enqueueMutation({ body: { action: 'bonus', bonus: nextBonus }, gameId: game.id, apply });
    if (nextBonus > oldBonus) { celebrate(); toast.success('+100 Yahtzee bonus'); }
  }

  async function beginNewGame() {
    if (!game || !host) return;
    const next = await api({ action: 'new-game', gameId: game.id, confirm: true });
    if (next) { setModal(null); setView('game'); toast.success('New game started.'); }
  }

  function requestNewGame() {
    if (!game || !host || busy || savingCount) return;
    if (game.ended_at || score.remaining === 0) void beginNewGame();
    else if (score.filled === 0) setView('game');
    else setModal('new');
  }

  function openCurrentGame() {
    if (!game || !sheet) return;
    if (game.ended_at || score.remaining === 0) { if (host) void beginNewGame(); return; }
    setView('game');
  }

  async function shareTable() {
    if (!state) return;
    const invite = new URL(window.location.href);
    invite.search = '';
    invite.hash = '';
    invite.searchParams.set('table', state.room.code);
    const url = invite.toString();
    try {
      const text = `Join my Yahtzee game with code ${state.room.code}.`;
      if (navigator.share) await navigator.share({ title: 'Play Yahtzee with me', text, url });
      else { await navigator.clipboard.writeText(url); toast.success('Invite link copied'); }
    } catch (caught) {
      if (!(caught instanceof DOMException) || caught.name !== 'AbortError') toast.error('The invite link could not be shared.');
    }
  }

  function openScore(chosen: Category) {
    const value = sheet?.scores[chosen.id];
    setCategory(chosen);
    setNumeric(value === null || value === undefined ? '' : String(value));
  }

  function pressYahtzee() {
    if (!sheet) return;
    if (sheet.scores.yahtzee === 50) { void changeBonus(sheet.bonus + 1); return; }
    openScore(yahtzeeCategory);
  }

  function pressKey(key: string) {
    if (key === 'clear') { setNumeric(''); return; }
    if (key === 'back') { setNumeric(value => value.slice(0, -1)); return; }
    setNumeric(value => {
      const next = `${value === '0' ? '' : value}${key}`;
      return next.length <= 2 && Number(next) <= 30 ? next : value;
    });
  }

  function showNextBonusPlan() {
    if (score.upper >= 63) { toast.success('Upper bonus secured'); return; }
    if (bonusNeeded > maxRemainingUpper || !plans.length) { toast('The upper bonus is no longer reachable on this sheet.'); return; }
    setBonusPlanIndex(index => index < 0 ? 0 : index + 1 >= plans.length ? -1 : index + 1);
  }

  async function retryGoogleSync() {
    const user = googleUserRef.current;
    if (!user) return;
    try {
      setAuthBusy(true);
      await getGoogleIdToken(user, true);
      const legacyState = pagesBuild ? await loadGoogleScores(user.uid) : null;
      const next = await api({ action: 'bootstrap', legacyState });
      if (next) await api({ action: 'sync-profile', name: user.displayName || 'Player', photoUrl: user.photoURL });
      setAccountError('');
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : 'Google sign-in could not finish.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function confirmDeletion() {
    const target = deleteTarget;
    if (!target) return;
    const next = await api({ action: 'delete-game', gameId: target.id });
    if (!next) return;
    toast.success('Game deleted');
  }

  const live = game ? [...game.sheets].sort((a, b) => totals(b.scores, b.bonus).total - totals(a.scores, a.bonus).total) : [];
  const visibleHistory = state?.history.filter(gameHasMoves) || [];
  const played = visibleHistory.filter(item => item.ended_at);
  const leaders = leaderboard(visibleHistory);
  const best = played.length ? Math.max(...played.flatMap(item => item.sheets.map(playerSheet => totals(playerSheet.scores, playerSheet.bonus).total))) : 0;
  const groups = visibleHistory.filter(item => item.id !== game?.id || item.ended_at).reduce<Record<string, Game[]>>((acc, item) => {
    const key = fmtDate(item.started_at);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  const activePlayers = state?.players.filter(player => player.active) || [];
  const gameInProgress = !!game && !!sheet && !game.ended_at && score.filled > 0 && score.remaining > 0;
  const waitingForPlayers = !!sheet?.completed_at && !game?.ended_at;

  function row(chosen: Category, index: number) {
    const value = sheet?.scores[chosen.id], filled = value !== null && value !== undefined, Icon = icons[index];
    const target = !filled && activePlan ? activePlan[chosen.id] : undefined;
    return <button key={chosen.id} className={`score-row ${filled ? 'filled' : ''} ${value === 0 ? 'zero' : ''} ${openOnly && filled ? 'hidden-row' : ''}`} disabled={!sheet} aria-label={`${chosen.name}, ${filled ? `${value} points. Edit score` : target !== undefined ? `bonus plan target ${target} dice. Enter score` : 'not scored. Enter score'}`} onClick={() => openScore(chosen)}>
      <span className="score-icon"><Icon strokeWidth={2} /></span>
      <span className="row-label"><span>{chosen.name}</span>{target !== undefined && <span className="bonus-target">×<Count value={target} /></span>}</span>
      <span className="score-value">{filled ? <Count value={value} /> : <Plus size={15} strokeWidth={1.4} />}</span>
    </button>;
  }

  const planText = activePlan ? <><Count value={bonusNeeded} /> needed · plan <Count value={bonusPlanIndex + 1} />/<Count value={plans.length} /></> : <><Count value={score.upper} /> / 63</>;

  return <div className="app">
    <Toaster position="top-center" richColors />
    <header className="topbar">
      <button className="brand brand-button" onClick={() => { setView('home'); setHomeTab('home'); }} aria-label="Go to Yahtzee home"><span className="brand-icon"><Dice5 size={28} strokeWidth={1.7} /></span><span>Yahtzee</span></button>
      <div className="header-right"><button className="profile-btn" onClick={() => { setProfileName(me?.name === 'You' ? '' : me?.name || ''); setModal('profile'); }}><Avatar name={googleUser?.displayName || me?.name || 'You'} photoUrl={profilePhoto} /><span>{headerName}</span>{googleUser ? <ChevronDown size={13} /> : <LogIn size={13} />}</button></div>
    </header>

    <main className="shell">
      {error && <div role="alert" className="inline-error sync-banner">{error} <button className="text-btn" onClick={() => void api({ action: 'bootstrap' })}>Reconnect</button></div>}

      {view === 'game' ? <>
          {state && !sheet && <p className="inline-error" style={{ marginBottom: 16 }}>This game is finished. Tap the Yahtzee logo to return home.</p>}
          <div className="game-grid">
            <section className="sheet">
              <div className="sheet-head"><h2>{me?.name && me.name !== 'You' ? `${firstName(me.name)}’s` : 'Your'} score sheet</h2><button className={`pill filter ${openOnly ? '' : 'neutral'}`} aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>{openOnly ? <Check size={12} /> : null}<Count value={score.remaining} /> left {openOnly ? '· show all' : <ChevronDown size={12} />}</button></div>
              <div className="score-columns">
                <div className="score-section">
                  <div className="section-label">Upper section <span>01—06</span></div>
                  {categories.slice(0, 6).map((item, index) => row(item, index))}
                  <button type="button" className={`bonus-box ${activePlan ? 'active' : ''}`} onClick={showNextBonusPlan} aria-label="Show dice targets for the upper bonus">
                    <div className="bonus-top"><span className="inline" style={{ gap: 5 }}><Sparkles size={12} />Bonus</span><strong>{planText}</strong></div>
                    <Progress className="bonus-progress" aria-label="Upper bonus progress" value={Math.min(score.upper / 63 * 100, 100)} />
                    <p>{activePlan ? (plans.length > 1 ? 'Tap for another plan' : 'Tap to hide plan') : 'Tap for a dice target plan'}</p>
                  </button>
                  <div className="subtotal"><span>Upper total</span><strong><Count value={score.upperTotal} /></strong></div>
                </div>
                <div className="score-section">
                  <div className="section-label">Lower section <span>07—13</span></div>
                  {categories.slice(6).filter(item => item.id !== 'yahtzee').map(item => row(item, categories.indexOf(item)))}
                  {!(openOnly && sheet?.scores.yahtzee === 0) && <button className="celebrate-btn yahtzee-score-btn" disabled={!sheet || sheet.scores.yahtzee === 50 && sheet.bonus >= 12} onClick={pressYahtzee} aria-label={sheet?.scores.yahtzee === 50 ? `Add 100 point Yahtzee bonus. ${(sheet.bonus || 0) * 100} bonus points logged.` : sheet?.scores.yahtzee === 0 ? 'Yahtzee, 0 points. Edit score.' : 'Yahtzee, not scored. Choose 0 or 50.'}><Sparkles size={19} /><span className="yahtzee-button-label">YAHTZEE!</span>{sheet?.scores.yahtzee === null || sheet?.scores.yahtzee === undefined ? <Sparkles size={19} /> : <span className="yahtzee-score-value"><Count value={sheet.scores.yahtzee} /></span>}</button>}
                  {sheet?.scores.yahtzee !== 0 && <div className="yahtzee-bonus"><span className="inline" style={{ gap: 4 }}><Sparkles size={13} />Yahtzee bonus</span><strong><Count value={(sheet?.bonus || 0) * 100} /></strong></div>}
                  <div className="subtotal"><span>Lower total</span><strong><Count value={score.lower} /></strong></div>
                </div>
              </div>
            </section>

            <aside className="side">
              <section className={`total-card ${score.remaining === 0 ? 'complete' : ''}`}><div className="eyebrow">Final score</div><div className="total-number"><Count value={score.total} /><span>pts</span></div><div className="total-breakdown"><div><span>Upper</span><strong><Count value={score.upper} /></strong></div><div><span>Bonus</span><strong>{score.upperBonus ? <>+<Count value={35} /></> : '—'}</strong></div><div><span>Lower</span><strong><Count value={score.lower} /></strong></div></div><Progress className="game-progress" aria-label="Categories completed" value={score.filled / 13 * 100} /></section>
            </aside>
          </div>
        </> : <Tabs value={homeTab} onValueChange={value => setHomeTab(value as typeof homeTab)} className="app-tabs home-tabs">
        <TabsList className="nav-tabs" aria-label="Home views">
          <TabsTrigger value="home"><HomeIcon size={17} />Home</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy size={17} />Leaderboard</TabsTrigger>
          <TabsTrigger value="history"><History size={17} />Game history</TabsTrigger>
        </TabsList>

        <TabsContent value="home">
          <div className="home-heading"><div><h1>{gameInProgress ? 'Pick up where you left off.' : waitingForPlayers ? 'Waiting for the final scores.' : 'Let’s play Yahtzee.'}</h1></div><button className="btn invite-top" onClick={() => setModal('invite')} disabled={!state}><UserPlus size={16} />Invite player</button></div>
          <div className="home-grid">
            <section className="start-card">
              <div className="start-row">
                <div className="start-mark"><Dices size={34} /></div>
                <div className="start-actions"><button className="btn primary start-game" disabled={!state || !sheet || waitingForPlayers && !host || busy || !!savingCount} onClick={openCurrentGame}><Play size={17} />{gameInProgress ? 'Continue game' : game?.ended_at || score.remaining === 0 ? 'Play another game' : 'Start game'}</button>{gameInProgress && host && <button className="text-btn start-over" onClick={requestNewGame}>Start a new game</button>}</div>
              </div>
            </section>

            <section className="players-card">
              <div className="card-heading"><div><p className="eyebrow">Players</p><h2>Ready to play</h2></div><span className="pill neutral"><Count value={activePlayers.length || 1} /> active</span></div>
              <div className="active-player-list">{(state?.players.length ? state.players : me ? [{ ...me, active: true }] : []).map(player => <div className="active-player" key={player.id}><Avatar name={player.name} photoUrl={player.photo_url} /><span><strong>{player.name}{player.id === me?.id && player.name !== 'You' ? ' (you)' : ''}</strong><small>{player.active ? 'Ready now' : 'Away'}</small></span><span className={`presence ${player.active ? 'online' : ''}`} aria-label={player.active ? 'Active' : 'Away'} /></div>)}</div>
              {!browserMode && <form className="join-inline" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'join-room', code: joinCode }); if (next) { setJoinCode(''); toast.success('You joined the game.'); } }}><label className="field-label" htmlFor="home-join-code">Have an invite code?</label><div className="inline"><input id="home-join-code" className="field" placeholder="ABC123" autoCapitalize="characters" autoCorrect="off" maxLength={8} value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} /><button className="btn" disabled={busy || ![4, 6, 8].includes(joinCode.replace(/[^a-z0-9]/gi, '').length)}>Join<ArrowRight size={14} /></button></div></form>}
              {googleUser && state?.mode === 'online' && <div className="cloud-note"><Cloud size={16} /><span><strong>Online game connected</strong><small>Players can join from any network with the invite link or code.</small></span></div>}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="leaderboard">
          <div className="intro"><h1>Leaderboard</h1><button className="btn" onClick={() => setHomeTab('home')}><Play size={16} />Play</button></div>
          <div className="leader-stats"><div className="stat-box"><small>Games</small><strong><Count value={played.length} format={value => value.toString().padStart(2, '0')} /></strong></div><div className="stat-box"><small>High score</small><strong>{best ? <Count value={best} /> : '—'}</strong></div><div className="stat-box"><small>Players</small><strong>{leaders.length || live.length ? <Count value={leaders.length || live.length} /> : '—'}</strong></div></div>
          {leaders.length ? <div className="leader-table"><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Player</TableHead><TableHead>Wins</TableHead><TableHead>Best</TableHead><TableHead>Average</TableHead><TableHead>Games</TableHead></TableRow></TableHeader><TableBody>{leaders.map((player, index) => <TableRow key={player.id}><TableCell>{index === 0 && player.wins ? <Trophy size={18} color="#9a883a" /> : index + 1}</TableCell><TableCell><span className="name-cell"><Avatar name={player.name} photoUrl={player.photo_url} />{player.name}</span></TableCell><TableCell><strong><Count value={player.wins} /></strong></TableCell><TableCell><Count value={player.best} /></TableCell><TableCell><Count value={Math.round(player.sum / player.games)} /></TableCell><TableCell><Count value={player.games} /></TableCell></TableRow>)}</TableBody></Table></div> : <Empty kind="trophy" title="No completed games" body="Finish a game to start the leaderboard." action={<button className="btn primary" onClick={() => setHomeTab('home')}>Start a game<ArrowRight size={15} /></button>} />}
        </TabsContent>

        <TabsContent value="history">
          <div className="intro"><h1>Game history</h1><button className="btn" onClick={() => setHomeTab('home')}><Play size={16} />Play</button></div>
          <div className="history-layout">{Object.keys(groups).length ? Object.entries(groups).map(([day, games]) => <section key={day}><h2 className="history-date">{day}</h2>{games.map(item => <HistoryCard key={item.id} game={item} canDelete={!!host} onDelete={() => setDeleteTarget({ id: item.id, name: fmtTime(item.started_at) })} />)}</section>) : <Empty kind="history" title="No games yet" body="Games appear here after the first score is placed. Blank sheets are never saved." action={<button className="btn primary" onClick={() => setHomeTab('home')}>Start a game<ArrowRight size={15} /></button>} />}</div>
        </TabsContent>
      </Tabs>}
    </main>

    <Dialog open={!!category} onOpenChange={open => { if (!open) { setCategory(null); setNumeric(''); } }}>
      <DialogContent className="modal score-modal" onCloseAutoFocus={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>{category?.name}</DialogTitle><DialogDescription>{category && 'face' in category ? `How many ${category.name.toLowerCase()} did you roll?` : category?.hint}</DialogDescription></DialogHeader>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {category && 'face' in category ? <div className="choices">{[0, 1, 2, 3, 4, 5].map(number => <button key={number} className={`choice ${number === 0 ? 'zero-choice' : ''}`} onClick={() => saveScore(category, number * category.face)}>{number * category.face}<small>{number === 0 ? 'Cross out' : `${number} ${number === 1 ? 'die' : 'dice'}`}</small></button>)}</div>
          : category && 'fixed' in category ? <div className="choices fixed-scores"><button className="choice zero-choice" onClick={() => saveScore(category, 0)}>0<small>Cross out</small></button><button className="choice" onClick={() => saveScore(category, category.fixed)}>{category.fixed}<small>Score it</small></button></div>
            : <form onSubmit={event => { event.preventDefault(); if (category && numeric.trim() && Number(numeric) >= 5 && Number(numeric) <= 30) void saveScore(category, Number(numeric)); }}>
              <span className="field-label" id="score-input-label">Total of all five dice (5–30)</span>
              <output className="number-input" aria-labelledby="score-input-label" aria-live="polite">{numeric || '0'}</output>
              <div className="keypad" aria-label="Score keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map(key => <button key={key} type="button" className={`keypad-key ${key === 'clear' || key === 'back' ? 'keypad-action' : ''}`} onClick={() => pressKey(key)} aria-label={key === 'clear' ? 'Clear' : key === 'back' ? 'Backspace' : key}>{key === 'clear' ? 'Clear' : key === 'back' ? '⌫' : key}</button>)}</div>
              <div className="actions" style={{ marginTop: 14 }}><button className="btn" type="button" onClick={() => category && saveScore(category, 0)}>Cross out · 0</button><button className="btn primary" disabled={!numeric.trim() || Number(numeric) < 5 || Number(numeric) > 30 || !Number.isInteger(Number(numeric))} type="submit">Save score<Check size={16} /></button></div>
            </form>}
        {category && sheet?.scores[category.id] != null && <button className="btn clear-category" onClick={() => saveScore(category, null)}><X size={15} />Clear category</button>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!modal} onOpenChange={open => { if (!open && !busy) setModal(null); }}>
      <DialogContent className="modal">
        {modal === 'profile' && <>
          <DialogHeader><DialogTitle>Profile</DialogTitle></DialogHeader>
          {!lanMode && <div className="google-auth">{googleUser ? <><div className="google-account"><Avatar name={googleUser.displayName || googleUser.email || 'G'} photoUrl={googleUser.photoURL} /><span><strong>{googleUser.displayName || 'Google account'}</strong><small>{googleUser.email}</small></span></div><button className="btn" disabled={authBusy} onClick={async () => { try { setAuthBusy(true); await signOutGoogle(); googleUserRef.current = null; setGoogleUser(null); setAccountError(''); } catch (caught) { setAccountError(caught instanceof Error ? caught.message : 'Could not sign out.'); } finally { setAuthBusy(false); } }}><LogOut size={15} />Sign out</button></> : <button className="btn google-btn" disabled={authBusy} onClick={async () => { try { setAuthBusy(true); await signInWithGoogle(); } catch (caught) { setAccountError(caught instanceof Error ? caught.message : 'Google sign-in was canceled.'); } finally { setAuthBusy(false); } }}><span className="google-g">G</span>{authBusy ? 'Opening Google…' : 'Sign in with Google'}</button>}</div>}
          {accountError && <div role="alert" className="inline-error account-error">{accountError} {googleUser && <button className="text-btn" disabled={authBusy} onClick={() => void retryGoogleSync()}>Try again</button>}</div>}
          <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'rename', name: profileName }); if (next) setModal(null); }}><label className="field-label" htmlFor="player-name">Player name</label><input id="player-name" className="field" autoFocus maxLength={32} placeholder="David" value={profileName} onChange={event => setProfileName(event.target.value)} required /><button className="btn primary" style={{ width: '100%', marginTop: 15 }} disabled={busy || !profileName.trim()}>Save<Check size={16} /></button></form>
        </>}

        {modal === 'invite' && <>
          <DialogHeader><DialogTitle>Invite a player</DialogTitle><DialogDescription>{browserMode ? 'Sign in with Google to create or join an online game.' : 'Share this link or code. Players can join from any network and will appear on Home automatically.'}</DialogDescription></DialogHeader>
          {browserMode && !googleUser && <button className="btn google-btn" disabled={authBusy} onClick={async () => { try { setAuthBusy(true); await signInWithGoogle(); } catch (caught) { setAccountError(caught instanceof Error ? caught.message : 'Google sign-in was canceled.'); } finally { setAuthBusy(false); } }}><span className="google-g">G</span>{authBusy ? 'Opening Google…' : 'Sign in to play online'}</button>}
          {me?.name === 'You' && <button className="btn" onClick={() => { setProfileName(''); setModal('profile'); }}>First, add your name<ArrowRight size={15} /></button>}
          {state && !browserMode && <div className="room-code">{state.room.code}</div>}
          {!browserMode && <button className="btn primary share-table" onClick={() => void shareTable()}><Share2 size={16} />Share invite</button>}
          {!browserMode && <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'join-room', code: joinCode }); if (next) { setModal(null); setJoinCode(''); toast.success('You joined the game.'); } }}><label className="field-label" htmlFor="join-code">Invite code</label><div className="inline"><input id="join-code" className="field" placeholder="ABC123" autoCapitalize="characters" autoCorrect="off" maxLength={8} value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} /><button className="btn" disabled={busy || ![4, 6, 8].includes(joinCode.replace(/[^a-z0-9]/gi, '').length)}>Join<ArrowRight size={14} /></button></div></form>}
          {browserMode && <p className="install-note">After signing in, this screen will show your room code and manual join box.</p>}
          {accountError && <div role="alert" className="inline-error">{accountError}</div>}
          {error && <div role="alert" className="inline-error">{error}</div>}
        </>}

        {modal === 'new' && <><DialogHeader><DialogTitle>Start a new game?</DialogTitle><DialogDescription>This game isn’t finished. Starting over will save it as unfinished.</DialogDescription></DialogHeader><div className="actions"><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={busy || !host} onClick={() => void beginNewGame()}>Start new game<ArrowRight size={15} /></button></div>{error && <p className="inline-error">{error}</p>}</>}
        {modal === 'finish' && <><DialogHeader><DialogTitle>Final score</DialogTitle><DialogDescription>{me?.name === 'You' ? 'Your' : `${firstName(me?.name || 'Your')}’s`} game is complete.</DialogDescription></DialogHeader><div><div className="finish-line"><span>Upper section</span><strong><Count value={score.upper} /></strong></div>{phase >= 1 && <div className="finish-line"><span>Upper bonus</span><strong>{score.upperBonus ? <>+<Count value={35} /></> : <Count value={0} />}</strong></div>}{phase >= 2 && <div className="finish-line"><span>Lower section {sheet?.bonus ? '(includes Yahtzee bonus)' : ''}</span><strong><Count value={score.lower} /></strong></div>}</div><div className="finish-score"><p>GRAND TOTAL</p><strong><Count value={phase >= 3 ? score.total : 0} duration={700} /></strong></div><div className="actions"><button className="btn" onClick={() => { setModal(null); setHomeTab('history'); }}>Game history</button><button className="btn primary" onClick={() => { setModal(null); setHomeTab('home'); }}>Back home<ArrowRight size={15} /></button></div></>}
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent className="delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete game?</AlertDialogTitle>
          <AlertDialogDescription>Delete the {deleteTarget?.name} game and all of its scores?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="delete-action" onClick={() => void confirmDeletion()}>Delete</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {celebrating && <div className="celebration" aria-live="polite"><div className="celebration-word">YAHTZEE!</div>{Array.from({ length: 52 }, (_, index) => <span key={index} className="confetti" style={{ left: `${(index * 37) % 101}%`, background: ['#dcf0a5', '#edc965', '#83b8a0', '#ffffff', '#d7a877'][index % 5], animationDelay: `${(index % 9) * .05}s`, '--drift': `${((index * 29) % 280) - 140}px`, transform: `rotate(${index * 20}deg)` } as CSSProperties} />)}</div>}
  </div>;
}

function HistoryCard({ game, canDelete, onDelete }: { game: Game; canDelete: boolean; onDelete: () => void }) {
  const sorted = [...game.sheets].sort((a, b) => totals(b.scores, b.bonus).total - totals(a.scores, a.bonus).total);
  const top = sorted[0], high = top ? totals(top.scores, top.bonus).total : 0;
  const winners = sorted.filter(item => totals(item.scores, item.bonus).total === high);
  const scoreRows = [
    ...categories.map(category => ({ id: category.id, name: category.name, value: (item: Sheet) => item.scores[category.id] ?? '—' })),
    { id: 'upper-bonus', name: 'Upper bonus', value: (item: Sheet) => totals(item.scores, item.bonus).upperBonus },
    { id: 'yahtzee-bonus', name: 'Yahtzee bonus', value: (item: Sheet) => item.bonus * 100 },
    { id: 'total', name: 'Total', value: (item: Sheet) => totals(item.scores, item.bonus).total },
  ];
  return <details className="history-card">
    <summary>
      <div className="history-summary-main">
        <h3>{fmtTime(game.started_at)} <span>·</span> {game.sheets.length} {game.sheets.length === 1 ? 'player' : 'players'}</h3>
        <p>{game.ended_at ? `${Math.max(1, Math.round((game.ended_at - game.started_at) / 60000))} min · ${sorted.length === 1 ? 'Solo game' : winners.length > 1 ? 'Shared victory' : `${top?.name} won`}` : 'Unfinished game · not counted in wins'}</p>
      </div>
      {top && <div className="history-winner"><Avatar name={top.name} photoUrl={top.photo_url} /><span>{top.name}</span></div>}
      <span className="history-score"><span className={`pill ${game.ended_at ? '' : 'neutral'}`}>{game.ended_at ? <Trophy size={13} /> : <Flag size={13} />} {game.ended_at ? `${high} pts` : 'Unfinished'}</span><ChevronDown size={16} /></span>
    </summary>
    {canDelete && <button className="history-delete" aria-label={`Delete game from ${fmtTime(game.started_at)}`} onClick={event => { event.preventDefault(); onDelete(); }}><Trash2 size={17} /></button>}
    <div className="history-results">
      <div className="history-standings">{sorted.map((item, index) => <div className="player-row" key={item.player_id}><span className="player-rank">{index + 1}</span><Avatar name={item.name} photoUrl={item.photo_url} /><span className="player-name">{item.name}<small>{item.completed_at ? 'Finished' : `${totals(item.scores, item.bonus).filled} of 13 scored`}</small></span><span className="player-score">{totals(item.scores, item.bonus).total}</span></div>)}</div>
      {sorted.map(item => <div className="history-scorecard" key={item.player_id}>
        <div className="history-scorecard-head"><span>{item.name}</span><strong>{totals(item.scores, item.bonus).total}</strong></div>
        <div className="history-score-grid">{scoreRows.map(row => <div className={`history-score-cell ${row.id === 'total' ? 'total' : ''}`} key={row.id}><span>{row.name}</span><strong>{row.value(item)}</strong></div>)}</div>
      </div>)}
    </div>
  </details>;
}
