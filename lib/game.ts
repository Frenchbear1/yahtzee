export const categories = [
  {id:'ones',name:'Aces',hint:'Add all ones',face:1}, {id:'twos',name:'Twos',hint:'Add all twos',face:2},
  {id:'threes',name:'Threes',hint:'Add all threes',face:3}, {id:'fours',name:'Fours',hint:'Add all fours',face:4},
  {id:'fives',name:'Fives',hint:'Add all fives',face:5}, {id:'sixes',name:'Sixes',hint:'Add all sixes',face:6},
  {id:'kind3',name:'3 of a kind',hint:'Total of all five dice'}, {id:'kind4',name:'4 of a kind',hint:'Total of all five dice'},
  {id:'house',name:'Full house',hint:'Three + two matching',fixed:25}, {id:'small',name:'Small straight',hint:'Four in a row',fixed:30},
  {id:'large',name:'Large straight',hint:'Five in a row',fixed:40}, {id:'yahtzee',name:'Yahtzee',hint:'Five of a kind',fixed:50},
  {id:'chance',name:'Chance',hint:'Total of all five dice'}
] as const;
export type Category = typeof categories[number];
export type Scores = Record<string,number|null>;
export type Sheet = {game_id:string;player_id:string;name:string;photo_url:string|null;scores:Scores;bonus:number;revision:number;completed_at:number|null};
export type Game = {id:string;room_id:string;started_at:number;ended_at:number|null;sheets:Sheet[]};
export type Room = {id:string;name:string;code:string;host_id:string};
export type TablePlayer = {id:string;name:string;photo_url:string|null;active:boolean};
export type ManagedRoom = Room & {members:Array<{id:string;name:string;photo_url:string|null}>};
export type State = {me:{id:string;name:string;photo_url:string|null};room:Room;rooms:Room[];managedRooms:ManagedRoom[];players:TablePlayer[];game:Game;history:Game[];mode?:string};
export function totals(scores:Scores={},bonus=0){const upper=categories.slice(0,6).reduce((a,c)=>a+(scores[c.id]??0),0);const upperBonus=upper>=63?35:0;const lower=categories.slice(6).reduce((a,c)=>a+(scores[c.id]??0),0)+bonus*100;const filled=categories.filter(c=>scores[c.id]!==null&&scores[c.id]!==undefined).length;return{upper,upperBonus,upperTotal:upper+upperBonus,lower,total:upper+upperBonus+lower,filled,remaining:13-filled};}
export function validScore(id:string,value:unknown){const c=categories.find(c=>c.id===id);if(!c)return false;if(value===null)return true;if(typeof value!=='number'||!Number.isInteger(value))return false;if('face'in c)return value>=0&&value<=c.face*5&&value%c.face===0;if('fixed'in c)return value===0||value===c.fixed;return value===0||(value>=5&&value<=30);}
export function leaderboard(history:Game[]){const rows=new Map<string,{id:string;name:string;photo_url:string|null;games:number;wins:number;best:number;sum:number}>();for(const g of history){if(!g.ended_at||!g.sheets.length||g.sheets.some(s=>!s.completed_at))continue;const max=Math.max(...g.sheets.map(s=>totals(s.scores,s.bonus).total));for(const s of g.sheets){const t=totals(s.scores,s.bonus).total;const r=rows.get(s.player_id)||{id:s.player_id,name:s.name,photo_url:s.photo_url||null,games:0,wins:0,best:0,sum:0};r.name=s.name;r.photo_url=s.photo_url||r.photo_url;r.games++;r.sum+=t;r.best=Math.max(r.best,t);if(g.sheets.length>1&&t===max)r.wins++;rows.set(s.player_id,r);}}return[...rows.values()].sort((a,b)=>b.wins-a.wins||b.best-a.best);}

export type BonusPlan = Record<string,number>;
export function bonusPlans(scores:Scores={},limit=3){
 const open=categories.slice(0,6).filter(c=>scores[c.id]===null||scores[c.id]===undefined);
 const current=categories.slice(0,6).reduce((sum,c)=>sum+(scores[c.id]??0),0),needed=Math.max(0,63-current);
 if(!open.length||needed===0)return [];
 const plans:Array<{plan:BonusPlan;points:number;effort:number;dice:number}> = [];
 const visit=(at:number,plan:BonusPlan,points:number,effort:number,dice:number)=>{
  if(at===open.length){if(points>=needed)plans.push({plan:{...plan},points,effort,dice});return}
  const c=open[at],face='face'in c?c.face:0;
  for(let count=0;count<=5;count++){plan[c.id]=count;visit(at+1,plan,points+count*face,effort+(count-3)**2,dice+count)}
 };
 visit(0,{},0,0,0);
 plans.sort((a,b)=>(a.points-needed)-(b.points-needed)||a.effort-b.effort||a.dice-b.dice);
 return plans.slice(0,Math.max(1,limit)).map(p=>p.plan);
}
