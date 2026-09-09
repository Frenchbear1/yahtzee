'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6,
  Dices, Download, Flag, History, House, Layers, LoaderCircle, LogIn, LogOut, Monitor, NotebookPen,
  Plus, RotateCcw, Settings, Sparkles, Star, TrendingUp, Trophy, UserMinus, Users,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toaster, toast } from 'sonner';
import { bonusPlans, categories, leaderboard, totals, type Category, type Game, type State } from '@/lib/game';
import { signInWithGoogle, signOutGoogle, syncGoogleProfile, watchGoogleAccount, type GoogleAccount } from '@/lib/firebase-profile';

const icons = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Layers, Layers, House, TrendingUp, ArrowUpRight, Star, Dices];
const yahtzeeCategory = categories.find(category => category.id === 'yahtzee')!;
const fmtTime = (value: number) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (value: number) => new Date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'You';

function Count({ value, duration = 120 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    function tick(time: number) {
      const progress = Math.min((time - start) / duration, 1);
      setDisplay(Math.round(from + (value - from) * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{display}</>;
}

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const initials = name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar"><span>{initials}</span>{photoUrl && <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}

function Empty({ kind, title, body, action }: { kind: 'history' | 'trophy'; title: string; body: string; action?: React.ReactNode }) {
  const Icon = kind === 'history' ? History : Trophy;
  return <div className="empty-card"><Icon size={35} strokeWidth={1.4} /><h2>{title}</h2><p>{body}</p>{action}</div>;
}

type UndoAction =
  | { kind: 'score'; category: string; value: number | null; bonus: number; gameId: string; revision: number }
  | { kind: 'bonus'; bonus: number; gameId: string; revision: number };

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('sheet');
  const [category, setCategory] = useState<Category | null>(null);
  const [numeric, setNumeric] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [modal, setModal] = useState<'family' | 'profile' | 'manage' | 'new' | 'finish' | null>(null);
  const [profileName, setProfileName] = useState('');
  const [tableName, setTableName] = useState('Family game night');
  const [joinCode, setJoinCode] = useState('');
  const [managedRoomId, setManagedRoomId] = useState('');
  const [managedRoomName, setManagedRoomName] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [bonusPlanIndex, setBonusPlanIndex] = useState(-1);
  const [celebrating, setCelebrating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [lastUndo, setLastUndo] = useState<UndoAction | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleAccount | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const token = useRef('');
  const snapshot = useRef<State | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const me = state?.me;
  const game = state?.game;
  const sheet = game?.sheets.find(item => item.player_id === me?.id);
  const score = totals(sheet?.scores, sheet?.bonus);
  const host = state?.room.host_id === me?.id;
  const mode = state?.mode === 'lan';
  const plans = useMemo(() => bonusPlans(sheet?.scores || {}, 3), [sheet?.scores]);
  const activePlan = bonusPlanIndex >= 0 && plans.length ? plans[bonusPlanIndex % plans.length] : null;
  const bonusNeeded = Math.max(0, 63 - score.upper);
  const maxRemainingUpper = categories.slice(0, 6).reduce((sum, item) => {
    if (sheet?.scores[item.id] !== null && sheet?.scores[item.id] !== undefined) return sum;
    return sum + ('face' in item ? item.face * 5 : 0);
  }, 0);
  const managedRoom = state?.managedRooms.find(room => room.id === managedRoomId) || state?.managedRooms[0];
  const headerName = firstName(googleUser?.displayName || me?.name || 'You');
  const profilePhoto = googleUser?.photoURL || me?.photo_url || null;

  const celebrate = useCallback(() => {
    setCelebrating(false);
    requestAnimationFrame(() => setCelebrating(true));
    if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    celebrateTimer.current = setTimeout(() => setCelebrating(false), 2700);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([50, 50, 80]);
  }, []);

  const api = useCallback(async (data: Record<string, unknown>, quiet = false): Promise<State | null> => {
    if (!token.current || busyRef.current) return null;
    if (!quiet) { busyRef.current = true; setBusy(true); }
    const requestSeq = ++seq.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/game', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-player-token': token.current },
        body: JSON.stringify(data),
      });
      const next = await response.json() as State & { error?: string };
      if (!response.ok) {
        if (response.status === 409) setTimeout(() => { void refreshRef.current(); }, 100);
        throw new Error(next.error || 'Your score could not be saved. Try again.');
      }
      if (requestSeq === seq.current) {
        snapshot.current = next;
        setState(next);
        setError('');
        setReady(true);
      }
      return next;
    } catch (caught) {
      if (requestSeq === seq.current) {
        setError(caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'Connection lost. Your input is still here. Please try again.');
        setReady(true);
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (!quiet) { busyRef.current = false; setBusy(false); }
    }
  }, []);

  const refreshRef = useRef<() => Promise<unknown>>(async () => {});
  refreshRef.current = () => api({ action: 'refresh' }, true);

  useEffect(() => {
    try {
      let saved = localStorage.getItem('yahtzee-player-key');
      if (!saved) {
        saved = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('yahtzee-player-key', saved);
      }
      token.current = saved;
    } catch {
      setError('Allow browser storage so this device can remember your player.');
      setReady(true);
      return;
    }
    const tableCode = new URLSearchParams(window.location.search).get('table');
    if (tableCode) { setJoinCode(tableCode); setModal('family'); }
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
    if (mode) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void watchGoogleAccount(async user => {
      if (stopped) return;
      setGoogleUser(user);
      if (!user) return;
      try {
        setAuthBusy(true);
        const accountToken = await syncGoogleProfile(user, token.current);
        token.current = accountToken;
        localStorage.setItem('yahtzee-player-key', accountToken);
        const next = await api({ action: 'bootstrap' });
        if (next) await api({ action: 'sync-profile', name: user.displayName || 'Player', photoUrl: user.photoURL });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Google sign-in could not finish.');
      } finally {
        setAuthBusy(false);
      }
    }).then(stop => { unsubscribe = stop; }).catch(caught => setError(caught instanceof Error ? caught.message : 'Google sign-in could not load.'));
    return () => { stopped = true; unsubscribe?.(); };
  }, [api, mode]);

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
    if (game?.id) { setLastUndo(null); setCategory(null); setOpenOnly(false); setBonusPlanIndex(-1); }
  }, [game?.id]);
  useEffect(() => { setBonusPlanIndex(-1); }, [sheet?.revision]);

  async function saveScore(chosen: Category, value: number | null, undoing = false, restoreBonus?: number) {
    if (!game || !sheet || !state) return;
    if (chosen.id === 'yahtzee' && value === 50 && sheet.scores.yahtzee === 50 && !undoing) {
      setCategory(null); setNumeric(''); await changeBonus(sheet.bonus + 1); return;
    }
    const previous = state, oldValue = sheet.scores[chosen.id] ?? null, oldBonus = sheet.bonus, before = score.filled;
    const nextBonus = chosen.id === 'yahtzee' ? (value === 50 ? (restoreBonus ?? sheet.bonus) : 0) : sheet.bonus;
    const updateGame = (item: Game): Game => item.id !== game.id ? item : {
      ...item,
      sheets: item.sheets.map(playerSheet => playerSheet.player_id === me?.id ? { ...playerSheet, scores: { ...playerSheet.scores, [chosen.id]: value }, bonus: nextBonus } : playerSheet),
    };
    setState({ ...state, game: updateGame(state.game), history: state.history.map(updateGame) });
    setCategory(null);
    setNumeric('');
    const next = await api({ action: 'score', gameId: game.id, category: chosen.id, value, revision: sheet.revision, ...(restoreBonus !== undefined ? { restoreBonus } : {}) });
    if (!next) { setState(previous); return; }
    const own = next.game.sheets.find(item => item.player_id === next.me.id)!;
    if (undoing) setLastUndo(null);
    else setLastUndo({ kind: 'score', category: chosen.id, value: oldValue, bonus: oldBonus, gameId: game.id, revision: own.revision });
    if (before < 13 && totals(own.scores, own.bonus).filled === 13) setModal('finish');
    else if (chosen.id === 'yahtzee' && value === 50 && oldValue !== 50) celebrate();
  }

  async function changeBonus(nextBonus: number, undoing = false) {
    if (!sheet || !game || !state || nextBonus < 0 || nextBonus > 12) return;
    const previous = state, oldBonus = sheet.bonus;
    const updateGame = (item: Game): Game => item.id !== game.id ? item : {
      ...item,
      sheets: item.sheets.map(playerSheet => playerSheet.player_id === me?.id ? { ...playerSheet, bonus: nextBonus } : playerSheet),
    };
    setState({ ...state, game: updateGame(state.game), history: state.history.map(updateGame) });
    const next = await api({ action: 'bonus', gameId: game.id, bonus: nextBonus, revision: sheet.revision });
    if (!next) { setState(previous); return; }
    const own = next.game.sheets.find(item => item.player_id === next.me.id)!;
    if (undoing) setLastUndo(null);
    else setLastUndo({ kind: 'bonus', bonus: oldBonus, gameId: game.id, revision: own.revision });
    if (nextBonus > oldBonus) { celebrate(); toast.success('+100 Yahtzee bonus'); }
  }

  async function undo() {
    if (!lastUndo || !sheet) return;
    if (sheet.revision !== lastUndo.revision) {
      setLastUndo(null);
      toast('Your sheet changed somewhere else. Tap the category to edit it.');
      return;
    }
    if (lastUndo.kind === 'bonus') { await changeBonus(lastUndo.bonus, true); return; }
    const chosen = categories.find(item => item.id === lastUndo.category)!;
    await saveScore(chosen, lastUndo.value, true, lastUndo.bonus);
  }

  async function beginNewGame() {
    if (!game || !host) return;
    const next = await api({ action: 'new-game', gameId: game.id, confirm: true });
    if (next) { setModal(null); setTab('sheet'); toast.success('New game started.'); }
  }

  function requestNewGame() {
    if (!game || !host || busy) return;
    if (game.ended_at) void beginNewGame(); else setModal('new');
  }

  async function copyCode(link = false) {
    if (!state) return;
    const value = link ? `${window.location.origin}/?table=${state.room.code}` : state.room.code;
    try { await navigator.clipboard.writeText(value); toast.success(link ? 'Table link copied' : 'Table code copied'); }
    catch { toast('Select and copy your table code below.'); }
  }

  function openScore(chosen: Category) {
    const value = sheet?.scores[chosen.id];
    setCategory(chosen);
    setNumeric(value === null || value === undefined ? '' : String(value));
  }

  function pressYahtzee() {
    if (!sheet || busy) return;
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

  function openRoomManagement() {
    const room = state?.managedRooms[0];
    if (room) { setManagedRoomId(room.id); setManagedRoomName(room.name); }
    setPendingRemoval(null);
    setModal('manage');
  }

  function chooseManagedRoom(roomId: string) {
    const room = state?.managedRooms.find(item => item.id === roomId);
    if (!room) return;
    setManagedRoomId(room.id);
    setManagedRoomName(room.name);
    setPendingRemoval(null);
  }

  const live = game ? [...game.sheets].sort((a, b) => totals(b.scores, b.bonus).total - totals(a.scores, a.bonus).total) : [];
  const played = state?.history.filter(item => item.ended_at) || [];
  const leaders = leaderboard(state?.history || []);
  const best = played.length ? Math.max(...played.flatMap(item => item.sheets.map(playerSheet => totals(playerSheet.scores, playerSheet.bonus).total))) : 0;
  const groups = (state?.history || []).filter(item => item.id !== game?.id || item.ended_at).reduce<Record<string, Game[]>>((acc, item) => {
    const key = fmtDate(item.started_at);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  function row(chosen: Category, index: number) {
    const value = sheet?.scores[chosen.id], filled = value !== null && value !== undefined, Icon = icons[index];
    const target = !filled && activePlan ? activePlan[chosen.id] : undefined;
    return <button key={chosen.id} className={`score-row ${filled ? 'filled' : ''} ${value === 0 ? 'zero' : ''} ${openOnly && filled ? 'hidden-row' : ''}`} disabled={!sheet || busy} aria-label={`${chosen.name}, ${filled ? `${value} points. Edit score` : target !== undefined ? `bonus plan target ${target} dice. Enter score` : 'not scored. Enter score'}`} onClick={() => openScore(chosen)}>
      <span className="score-icon"><Icon strokeWidth={2} /></span>
      <span className="row-label"><span>{chosen.name}</span>{target !== undefined && <span className="bonus-target">×{target}</span>}</span>
      <span className="score-value">{filled ? value : <Plus size={15} strokeWidth={1.4} />}</span>
    </button>;
  }

  const planText = activePlan ? `${bonusNeeded} needed · plan ${bonusPlanIndex + 1}/${plans.length}` : `${score.upper} / 63`;

  return <div className="app">
    <Toaster position="top-center" richColors />
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><Dice5 size={28} strokeWidth={1.7} /></span><span>Yahtzee</span></div>
      <div className="header-right"><button className="profile-btn" onClick={() => { setProfileName(me?.name === 'You' ? '' : me?.name || ''); setModal('profile'); }}><Avatar name={googleUser?.displayName || me?.name || 'You'} photoUrl={profilePhoto} /><span>{headerName}</span>{googleUser ? <ChevronDown size={13} /> : <LogIn size={13} />}</button></div>
    </header>

    <main className="shell">
      <Tabs value={tab} onValueChange={setTab} className="app-tabs">
        <TabsList className="nav-tabs" aria-label="App views">
          <TabsTrigger value="sheet"><NotebookPen size={17} />Score sheet</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy size={17} />Leaderboard</TabsTrigger>
          <TabsTrigger value="history"><History size={17} />Game history</TabsTrigger>
        </TabsList>
        {error && <div role="alert" className="inline-error sync-banner">{error} <button className="text-btn" onClick={() => void api({ action: 'bootstrap' })}>Reconnect</button></div>}

        <TabsContent value="sheet">
          <div className="compact-head">
            <span className="game-label">{game ? `Game ${state?.history.length.toString().padStart(2, '0')} · ${fmtTime(game.started_at)}` : 'New game'}</span>
            <button className="text-btn undo-top" disabled={!lastUndo || busy} onClick={() => void undo()}>{busy ? <LoaderCircle size={13} className="spinner" /> : <RotateCcw size={13} />}Undo</button>
            <button className="btn small" disabled={!state || !host || busy} onClick={requestNewGame}><Plus size={15} />New game</button>
          </div>
          {state && !sheet && <p className="inline-error" style={{ marginBottom: 16 }}>This game is already finished. The host can start a new game to give you a score sheet.</p>}
          <div className="game-grid">
            <section className="sheet">
              <div className="sheet-head"><h2>{me?.name && me.name !== 'You' ? `${firstName(me.name)}’s` : 'Your'} score sheet</h2><button className={`pill filter ${openOnly ? '' : 'neutral'}`} aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>{openOnly ? <Check size={12} /> : null}{score.remaining} left {openOnly ? '· show all' : <ChevronDown size={12} />}</button></div>
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
                  <button className="celebrate-btn yahtzee-score-btn" disabled={!sheet || busy || sheet.scores.yahtzee === 50 && sheet.bonus >= 12} onClick={pressYahtzee} aria-label={sheet?.scores.yahtzee === 50 ? `Add 100 point Yahtzee bonus. ${(sheet.bonus || 0) * 100} bonus points logged.` : sheet?.scores.yahtzee === 0 ? 'Yahtzee, 0 points. Edit score.' : 'Yahtzee, not scored. Choose 0 or 50.'}><Sparkles size={19} /><span className="yahtzee-button-label">YAHTZEE!</span>{sheet?.scores.yahtzee === null || sheet?.scores.yahtzee === undefined ? <Sparkles size={19} /> : <span className="yahtzee-score-value">{sheet.scores.yahtzee}</span>}</button>
                  <div className="yahtzee-bonus"><span className="inline" style={{ gap: 4 }}><Sparkles size={13} />Yahtzee bonus</span><strong>{(sheet?.bonus || 0) * 100}</strong></div>
                  <div className="subtotal"><span>Lower total</span><strong><Count value={score.lower} /></strong></div>
                </div>
              </div>
            </section>

            <aside className="side">
              <section className={`total-card ${score.remaining === 0 ? 'complete' : ''}`}><div className="eyebrow">Final score</div><div className="total-number"><Count value={score.total} /><span>pts</span></div><div className="total-breakdown"><div><span>Upper</span><strong><Count value={score.upper} /></strong></div><div><span>Bonus</span><strong>{score.upperBonus ? '+35' : '—'}</strong></div><div><span>Lower</span><strong><Count value={score.lower} /></strong></div></div><Progress className="game-progress" aria-label="Categories completed" value={score.filled / 13 * 100} /></section>
              <section className={`table-card ${tableOpen ? 'open' : ''}`}>
                <button className="card-heading table-toggle" aria-expanded={tableOpen} onClick={() => setTableOpen(!tableOpen)}><h2>{state?.room.name || 'My table'}</h2><span className="pill neutral">{live.length || 1} {live.length === 1 ? 'player' : 'players'} <ChevronDown size={13} /></span></button>
                <div className="table-body">
                  {live.map((playerSheet, index) => <div className="player-row" key={playerSheet.player_id}><span className="player-rank">{index + 1}</span><Avatar name={playerSheet.name} photoUrl={playerSheet.photo_url} /><span className="player-name">{playerSheet.name}{playerSheet.player_id === me?.id && playerSheet.name !== 'You' ? ' (you)' : ''}<small>{playerSheet.completed_at ? 'Finished' : `${totals(playerSheet.scores, playerSheet.bonus).remaining} left`}</small></span><span className="player-score"><Count value={totals(playerSheet.scores, playerSheet.bonus).total} /></span></div>)}
                  <div className="listening"><span />Listening · {state?.players.filter(player => player.active).length || 1} here</div>
                  <button className="btn" onClick={() => setModal('family')} disabled={!state}><Plus size={15} />Invite player</button>
                  {score.filled === 13 && <button className="btn primary" onClick={() => setModal('finish')}><Trophy size={15} />Final score</button>}
                </div>
              </section>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="leaderboard">
          <div className="intro"><h1>Leaderboard</h1><button className="btn" onClick={() => setModal('family')} disabled={!state}><Users size={16} />Change table</button></div>
          <div className="leader-stats"><div className="stat-box"><small>Games</small><strong>{played.length.toString().padStart(2, '0')}</strong></div><div className="stat-box"><small>High score</small><strong>{best || '—'}</strong></div><div className="stat-box"><small>Players</small><strong>{leaders.length || live.length || '—'}</strong></div></div>
          {leaders.length ? <div className="leader-table"><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Player</TableHead><TableHead>Wins</TableHead><TableHead>Best</TableHead><TableHead>Average</TableHead><TableHead>Games</TableHead></TableRow></TableHeader><TableBody>{leaders.map((player, index) => <TableRow key={player.id}><TableCell>{index === 0 && player.wins ? <Trophy size={18} color="#9a883a" /> : index + 1}</TableCell><TableCell><span className="name-cell"><Avatar name={player.name} photoUrl={player.photo_url} />{player.name}</span></TableCell><TableCell><strong>{player.wins}</strong></TableCell><TableCell>{player.best}</TableCell><TableCell>{Math.round(player.sum / player.games)}</TableCell><TableCell>{player.games}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty kind="trophy" title="No completed games" body="Finish a game to start the leaderboard." action={<button className="btn primary" onClick={() => setTab('sheet')}>Score sheet<ArrowRight size={15} /></button>} />}
        </TabsContent>

        <TabsContent value="history">
          <div className="intro"><h1>Game history</h1><button className="btn" onClick={() => setModal('family')} disabled={!state}><Users size={16} />Change table</button></div>
          <div className="history-layout">{Object.keys(groups).length ? Object.entries(groups).map(([day, games]) => <section key={day}><h2 className="history-date">{day}</h2>{games.map(item => <HistoryCard key={item.id} game={item} />)}</section>) : <Empty kind="history" title="No games yet" body="Finished games appear here." action={<button className="btn primary" onClick={() => setTab('sheet')}>Score sheet<ArrowRight size={15} /></button>} />}</div>
        </TabsContent>
      </Tabs>
    </main>

    <Dialog open={!!category} onOpenChange={open => { if (!open && !busy) { setCategory(null); setNumeric(''); } }}>
      <DialogContent className="modal score-modal" onCloseAutoFocus={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>{category?.name}</DialogTitle><DialogDescription>{category && 'face' in category ? `How many ${category.name.toLowerCase()} did you roll?` : category?.hint}</DialogDescription></DialogHeader>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {category && 'face' in category ? <div className="choices">{[0, 1, 2, 3, 4, 5].map(number => <button disabled={busy} key={number} className={`choice ${number === 0 ? 'zero-choice' : ''}`} onClick={() => void saveScore(category, number * category.face)}>{number * category.face}<small>{number === 0 ? 'Cross out' : `${number} ${number === 1 ? 'die' : 'dice'}`}</small></button>)}</div>
          : category && 'fixed' in category ? <div className="choices fixed-scores"><button disabled={busy} className="choice zero-choice" onClick={() => void saveScore(category, 0)}>0<small>Cross out</small></button><button disabled={busy} className="choice" onClick={() => void saveScore(category, category.fixed)}>{category.fixed}<small>Score it</small></button></div>
            : <form onSubmit={event => { event.preventDefault(); if (category && numeric.trim() && Number(numeric) >= 5 && Number(numeric) <= 30) void saveScore(category, Number(numeric)); }}>
              <span className="field-label" id="score-input-label">Total of all five dice (5–30)</span>
              <output className="number-input" aria-labelledby="score-input-label" aria-live="polite">{numeric || '0'}</output>
              <div className="keypad" aria-label="Score keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map(key => <button key={key} type="button" className={`keypad-key ${key === 'clear' || key === 'back' ? 'keypad-action' : ''}`} disabled={busy} onClick={() => pressKey(key)} aria-label={key === 'clear' ? 'Clear' : key === 'back' ? 'Backspace' : key}>{key === 'clear' ? 'Clear' : key === 'back' ? '⌫' : key}</button>)}</div>
              <div className="actions" style={{ marginTop: 14 }}><button className="btn" type="button" disabled={busy} onClick={() => category && void saveScore(category, 0)}>Cross out · 0</button><button className="btn primary" disabled={busy || !numeric.trim() || Number(numeric) < 5 || Number(numeric) > 30 || !Number.isInteger(Number(numeric))} type="submit">{busy ? 'Saving…' : 'Save score'}<Check size={16} /></button></div>
            </form>}
        {category && sheet?.scores[category.id] != null && <button className="btn clear-category" disabled={busy} onClick={() => void saveScore(category, null)}><RotateCcw size={15} />Clear category</button>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!modal} onOpenChange={open => { if (!open && !busy) setModal(null); }}>
      <DialogContent className="modal">
        {modal === 'profile' && <>
          <DialogHeader><DialogTitle>Profile</DialogTitle></DialogHeader>
          {!mode && <div className="google-auth">{googleUser ? <><div className="google-account"><Avatar name={googleUser.displayName || googleUser.email || 'G'} photoUrl={googleUser.photoURL} /><span><strong>{googleUser.displayName || 'Google account'}</strong><small>{googleUser.email}</small></span></div><button className="btn" disabled={authBusy} onClick={async () => { try { setAuthBusy(true); await signOutGoogle(); setGoogleUser(null); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not sign out.'); } finally { setAuthBusy(false); } }}><LogOut size={15} />Sign out</button></> : <button className="btn google-btn" disabled={authBusy} onClick={async () => { try { setAuthBusy(true); await signInWithGoogle(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Google sign-in was canceled.'); } finally { setAuthBusy(false); } }}><span className="google-g">G</span>{authBusy ? 'Opening Google…' : 'Sign in with Google'}</button>}</div>}
          <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'rename', name: profileName }); if (next) setModal(null); }}><label className="field-label" htmlFor="player-name">Player name</label><input id="player-name" className="field" autoFocus maxLength={32} placeholder="David" value={profileName} onChange={event => setProfileName(event.target.value)} required /><button className="btn primary" style={{ width: '100%', marginTop: 15 }} disabled={busy || !profileName.trim()}>Save<Check size={16} /></button></form>
          {!!state?.managedRooms.length && <button className="btn manage-button" onClick={openRoomManagement}><Settings size={16} />Manage tables</button>}
        </>}

        {modal === 'manage' && <>
          <DialogHeader><DialogTitle>Manage tables</DialogTitle><DialogDescription>Rename tables you own and remove players who should no longer join future games.</DialogDescription></DialogHeader>
          {state && state.managedRooms.length > 1 && <div className="room-list"><h3 className="field-label">Owned tables</h3>{state.managedRooms.map(room => <button key={room.id} className={`btn ${managedRoom?.id === room.id ? 'selected-room' : ''}`} onClick={() => chooseManagedRoom(room.id)}>{room.name}{managedRoom?.id === room.id ? <Check size={14} /> : <ArrowRight size={14} />}</button>)}</div>}
          {managedRoom && <>
            <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'rename-room', roomId: managedRoom.id, name: managedRoomName }); if (next) { const updated = next.managedRooms.find(room => room.id === managedRoom.id); if (updated) setManagedRoomName(updated.name); toast.success('Table name saved'); } }}><label className="field-label" htmlFor="managed-room-name">Table name</label><div className="inline"><input id="managed-room-name" className="field" maxLength={32} value={managedRoomName} onChange={event => setManagedRoomName(event.target.value)} required /><button className="btn primary" disabled={busy || !managedRoomName.trim()}>Save</button></div></form>
            <div className="section-divider member-management"><h3 className="field-label">Players</h3>{managedRoom.members.map(member => <div className="managed-member" key={member.id}><Avatar name={member.name} photoUrl={member.photo_url} /><span>{member.name}<small>{member.id === managedRoom.host_id ? 'Owner' : 'Member'}</small></span>{member.id !== managedRoom.host_id && (pendingRemoval === member.id ? <span className="remove-confirm"><button className="text-btn" onClick={() => setPendingRemoval(null)}>Cancel</button><button className="btn danger small" disabled={busy} onClick={async () => { const next = await api({ action: 'remove-member', roomId: managedRoom.id, playerId: member.id }); if (next) { setPendingRemoval(null); toast.success('Player removed'); } }}>Remove</button></span> : <button className="text-btn remove-member" onClick={() => setPendingRemoval(member.id)}><UserMinus size={15} />Remove</button>)}</div>)}</div>
          </>}
          <button className="btn" onClick={() => setModal('profile')}>Back to profile</button>
          {error && <div role="alert" className="inline-error">{error}</div>}
        </>}

        {modal === 'family' && <>
          <DialogHeader><DialogTitle>Your family table</DialogTitle><DialogDescription>{mode ? 'Everyone opens the address shown on the host computer, then joins with this code.' : 'Share your table link and code. Everyone scores on their own phone.'}</DialogDescription></DialogHeader>
          {me?.name === 'You' && <button className="btn" onClick={() => { setProfileName(''); setModal('profile'); }}>First, add your name<ArrowRight size={15} /></button>}
          {state && <><div className="room-code">{state.room.code}</div><div className="actions"><button className="btn" onClick={() => void copyCode()}><Copy size={15} />Copy code</button><button className="btn primary" onClick={() => void copyCode(true)}><Copy size={15} />Copy table link</button></div></>}
          <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'join-room', code: joinCode }); if (next) { setModal(null); setJoinCode(''); setTab('sheet'); toast.success('You’re at the table.'); } }}><label className="field-label" htmlFor="join-code">Table code</label><div className="inline"><input id="join-code" className="field" placeholder="ABCD" autoCapitalize="characters" autoCorrect="off" maxLength={8} value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} /><button className="btn primary" disabled={busy || ![4, 8].includes(joinCode.replace(/[^a-z0-9]/gi, '').length)}>Join<ArrowRight size={14} /></button></div></form>
          {error && <div role="alert" className="inline-error">{error}</div>}
          <form className="section-divider" onSubmit={async event => { event.preventDefault(); const next = await api({ action: 'create-room', name: tableName }); if (next) { toast.success('Your new table is ready. Share the code above.'); setTab('sheet'); } }}><label className="field-label" htmlFor="table-name">Start a separate table</label><div className="inline"><input className="field" id="table-name" value={tableName} onChange={event => setTableName(event.target.value)} maxLength={32} required /><button className="btn" disabled={busy || !tableName.trim()}>Create</button></div></form>
          {state && state.rooms.length > 1 && <div className="room-list section-divider"><h3 className="field-label">Your tables</h3>{state.rooms.map(room => <button key={room.id} className="btn" disabled={busy || room.id === state.room.id} onClick={async () => { if (await api({ action: 'switch-room', roomId: room.id })) { setModal(null); setTab('sheet'); } }}>{room.name}{room.id === state.room.id ? <Check size={14} /> : <ArrowRight size={14} />}</button>)}</div>}
          <div className="section-divider"><h3 className="modal-subheading inline"><Monitor size={16} />{mode ? 'Playing on Wi-Fi only' : 'Want Wi-Fi-only play?'}</h3><p className="install-note" style={{ marginTop: 8 }}>{mode ? 'Keep the host computer awake. Scores and game history are saved in its local database.' : 'The online version needs internet and Site access for each player. For private, internet-free play, run the local edition on one computer and connect everyone to the same Wi-Fi.'}</p>{!mode && <a className="btn" style={{ marginTop: 12, width: '100%' }} href="/yahtzee-local.zip" download><Download size={15} />Download the local edition</a>}</div>
        </>}

        {modal === 'new' && <><DialogHeader><DialogTitle>Start a new game?</DialogTitle><DialogDescription>This game isn’t finished. Starting over will save it as unfinished.</DialogDescription></DialogHeader><div className="actions"><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn primary" disabled={busy || !host} onClick={() => void beginNewGame()}>Start new game<ArrowRight size={15} /></button></div>{error && <p className="inline-error">{error}</p>}</>}
        {modal === 'finish' && <><DialogHeader><DialogTitle>Final score</DialogTitle><DialogDescription>{me?.name === 'You' ? 'Your' : `${firstName(me?.name || 'Your')}’s`} final score · {game ? fmtDate(game.started_at) : ''}</DialogDescription></DialogHeader><div><div className="finish-line"><span>Upper section</span><strong><Count value={score.upper} /></strong></div>{phase >= 1 && <div className="finish-line"><span>Upper bonus</span><strong>{score.upperBonus ? '+35' : '0'}</strong></div>}{phase >= 2 && <div className="finish-line"><span>Lower section {sheet?.bonus ? '(includes Yahtzee bonus)' : ''}</span><strong><Count value={score.lower} /></strong></div>}</div><div className="finish-score"><p>GRAND TOTAL</p><strong><Count value={phase >= 3 ? score.total : 0} duration={700} /></strong></div><p className="install-note">{game?.ended_at ? 'Saved with everyone’s scores in game history.' : 'Your score is saved. The table result will be final when everyone finishes.'}</p><div className="actions"><button className="btn" onClick={() => { setModal(null); setTab('history'); }}>Game history</button>{host ? <button className="btn primary" onClick={requestNewGame}>Play again<ArrowRight size={15} /></button> : <button className="btn primary" onClick={() => setModal(null)}>Back to the table</button>}</div></>}
      </DialogContent>
    </Dialog>

    {celebrating && <div className="celebration" aria-live="polite"><div className="celebration-word">YAHTZEE!</div>{Array.from({ length: 52 }, (_, index) => <span key={index} className="confetti" style={{ left: `${(index * 37) % 101}%`, background: ['#dcf0a5', '#edc965', '#83b8a0', '#ffffff', '#d7a877'][index % 5], animationDelay: `${(index % 9) * .05}s`, '--drift': `${((index * 29) % 280) - 140}px`, transform: `rotate(${index * 20}deg)` } as CSSProperties} />)}</div>}
  </div>;
}

function HistoryCard({ game }: { game: Game }) {
  const sorted = [...game.sheets].sort((a, b) => totals(b.scores, b.bonus).total - totals(a.scores, a.bonus).total);
  const top = sorted[0], high = top ? totals(top.scores, top.bonus).total : 0;
  const winners = sorted.filter(item => totals(item.scores, item.bonus).total === high);
  return <details className="history-card"><summary><div><h3>{fmtTime(game.started_at)} <span style={{ fontWeight: 400, color: '#91a095', margin: '0 5px' }}>·</span> {game.sheets.length} {game.sheets.length === 1 ? 'player' : 'players'}</h3><p>{game.ended_at ? `${Math.max(1, Math.round((game.ended_at - game.started_at) / 60000))} min · ${sorted.length === 1 ? 'Solo game' : winners.length > 1 ? 'Shared victory' : `${top?.name} won`}` : 'Unfinished game · not counted in wins'}</p><div className="history-players">{sorted.map(item => <Avatar key={item.player_id} name={item.name} photoUrl={item.photo_url} />)}</div></div><span className="inline"><span className={`pill ${game.ended_at ? '' : 'neutral'}`}>{game.ended_at ? <Trophy size={13} /> : <Flag size={13} />} {game.ended_at ? `${high} pts` : 'Unfinished'}</span><ChevronDown size={16} /></span></summary><div className="history-results">{sorted.map((item, index) => <div className="player-row" key={item.player_id}><span className="player-rank">{index + 1}</span><Avatar name={item.name} photoUrl={item.photo_url} /><span className="player-name">{item.name}<small>{item.completed_at ? 'Finished' : `${totals(item.scores, item.bonus).filled} of 13 scored`}</small></span><span className="player-score">{totals(item.scores, item.bonus).total}</span></div>)}<div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Category</TableHead>{sorted.map(item => <TableHead key={item.player_id}>{item.name}</TableHead>)}</TableRow></TableHeader><TableBody>{categories.map(category => <TableRow key={category.id}><TableCell>{category.name}</TableCell>{sorted.map(item => <TableCell key={item.player_id}>{item.scores[category.id] ?? '—'}</TableCell>)}</TableRow>)}<TableRow><TableCell>Upper bonus</TableCell>{sorted.map(item => <TableCell key={item.player_id}>{totals(item.scores, item.bonus).upperBonus}</TableCell>)}</TableRow><TableRow><TableCell>Yahtzee bonus</TableCell>{sorted.map(item => <TableCell key={item.player_id}>{item.bonus * 100}</TableCell>)}</TableRow><TableRow><TableCell><strong>Total</strong></TableCell>{sorted.map(item => <TableCell key={item.player_id}><strong>{totals(item.scores, item.bonus).total}</strong></TableCell>)}</TableRow></TableBody></Table></div></div></details>;
}
