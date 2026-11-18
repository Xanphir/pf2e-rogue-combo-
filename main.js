const MOD = "pf2e-rogue-combo";
const CAP = 2;
const SLUG = "eviscerate-primed";
const KEY = `${MOD}-pips`;
const FLAGS = `flags.${MOD}`;
const OFF_GUARD = ["off-guard", "flat-footed"];

const dbg = (...a) => { if (game.settings.get(MOD, "debug")) console.log(`${MOD} |`, ...a); };
const isActiveGM = () => game.users.activeGM?.isSelf === true;
const tracked = (a) => a?.type === "character" && (a.class?.slug === "rogue" || a.getFlag(MOD, "enabled") === true);
const points = (a) => Math.min(CAP, Math.max(0, Number(a.getFlag(MOD, "points")) || 0));
const primedEffect = (a) => a.itemTypes.effect.find((e) => e.slug === SLUG);
const setPoints = (a, n, extra = {}) => a.update({ [`${FLAGS}.points`]: Math.min(CAP, Math.max(0, n)), ...extra });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Gaining points ---------- */

async function resolveTarget(ctx, message) {
  // Prefer the token: an unlinked token's conditions live on its own synthetic actor, not the base actor.
  for (const uuid of [ctx.target?.token, ctx.target?.actor]) {
    if (!uuid) continue;
    try {
      const doc = await fromUuid(uuid);
      const found = doc?.actor ?? doc;
      if (found?.itemTypes) return found;
    } catch (e) { /* try the next source */ }
  }
  return message.author?.targets?.first?.()?.actor ?? null;
}

async function onAttack(actor, ctx, message) {
  const stop = (why, extra) => dbg(`no point: ${why}`, extra ?? "");
  if (ctx.domains?.includes("spell-attack-roll")) return stop("spell attack");
  const combat = game.combat;
  if (!combat?.started) return stop("no started combat");

  // Use the system's outcome, or compare the roll total to the DC if it is missing.
  let outcome = ctx.outcome;
  if (!outcome) {
    const total = message.rolls?.[0]?.total;
    const dc = ctx.dc?.value;
    if (Number.isFinite(total) && Number.isFinite(dc)) outcome = total >= dc ? "success" : "failure";
  }
  if (!["success", "criticalSuccess"].includes(outcome)) return stop("not a hit", { outcome });

  const opts = [...(ctx.options ?? [])];
  const target = await resolveTarget(ctx, message);
  const offGuard =
    opts.some((o) => o.startsWith("target:") && /off-guard|flat-footed/.test(o)) ||
    !!target?.itemTypes?.condition?.some((c) => OFF_GUARD.includes(c.slug));
  dbg("attack", { outcome, offGuard, target: target?.name, targetContext: ctx.target, options: opts });
  if (!offGuard) return stop("target is not off-guard");

  const last = actor.getFlag(MOD, "gain");
  if (last?.combat === combat.id && last?.round === combat.round) return stop("already gained this round");
  const now = points(actor);
  if (now >= CAP) return stop("already at the cap");

  await setPoints(actor, now + 1, { [`${FLAGS}.gain`]: { combat: combat.id, round: combat.round } });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<strong>Combo point gained</strong> (${now + 1}/${CAP}) for striking an off-guard target.`,
  });
}

async function onDamage(actor, ctx) {
  if (!ctx.domains?.includes("strike-damage")) return;
  await primedEffect(actor)?.delete(); // Eviscerate is used up by the Strike damage roll
}

Hooks.on("createChatMessage", async (message) => {
  const ctx = message.flags?.pf2e?.context;
  if (!ctx || !["attack-roll", "damage-roll"].includes(ctx.type)) return;
  if (!isActiveGM()) return dbg("skipped: this client is not the active GM", ctx.type);
  const actor = message.actor;
  if (!tracked(actor)) return dbg("skipped: speaker is not a tracked actor", ctx.type, actor?.name);
  dbg("message", ctx.type, actor.name);
  if (ctx.type === "attack-roll") await onAttack(actor, ctx, message);
  else await onDamage(actor, ctx);
});

Hooks.on("deleteCombat", async (combat) => {
  if (!isActiveGM()) return;
  for (const c of combat.combatants) {
    const actor = c.actor;
    if (!tracked(actor)) continue;
    await actor.update({ [`${FLAGS}.points`]: 0, [`${FLAGS}.gain`]: null });
    await primedEffect(actor)?.delete();
  }
});

/* ---------- Spending points: Eviscerate ---------- */

function buildEffect(n) {
  return {
    type: "effect",
    name: `Eviscerate (${n}d6)`,
    img: "icons/skills/wounds/blood-cells-vessel-red.webp",
    system: {
      slug: SLUG,
      description: { value: `<p>Your next Strike deals an additional ${n}d6 precision damage. This effect ends when you roll Strike damage.</p>` },
      tokenIcon: { show: true },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      rules: [{ key: "DamageDice", selector: "strike-damage", diceNumber: n, dieSize: "d6", category: "precision", label: "Eviscerate" }],
    },
  };
}

async function eviscerate(actor, spend) {
  if (!tracked(actor) || !actor.isOwner) return;
  if (!Number.isInteger(spend) || spend < 1 || spend > CAP) return;
  if (points(actor) < spend) return ui.notifications.warn("Not enough combo points.");
  if (primedEffect(actor)) return ui.notifications.warn("Eviscerate is already ready. Make your Strike first.");
  await setPoints(actor, points(actor) - spend);
  await actor.createEmbeddedDocuments("Item", [buildEffect(spend)]);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<strong>Eviscerate</strong>: spent ${spend} combo point${spend > 1 ? "s" : ""}. The next Strike deals +${spend}d6 precision damage.`,
  });
}

/* ---------- Token overlay ---------- */

function pip(g, x, y, r, on) {
  const pts = [x, y - r, x + r, y, x, y + r, x - r, y];
  const fill = on ? 0xc8372d : 0x14161a;
  const edge = on ? 0xd9a441 : 0x8f98a3;
  const alpha = on ? 1 : 0.75;
  if (typeof g.poly === "function") g.poly(pts).fill({ color: fill, alpha }).stroke({ width: 3, color: edge });
  else { g.lineStyle(3, edge, 1); g.beginFill(fill, alpha); g.drawPolygon(pts); g.endFill(); }
}

function drawPips(token) {
  const actor = token.actor;
  let box = token[KEY];
  if (!tracked(actor)) {
    if (box && !box.destroyed) box.destroy({ children: true });
    token[KEY] = null;
    return;
  }
  const pts = points(actor);
  const w = token.document.width * canvas.grid.size;
  if (box && !box.destroyed && box._pts === pts && box._w === w) return;
  if (!box || box.destroyed) {
    box = new PIXI.Container();
    box.eventMode = "none";
    box._g = new PIXI.Graphics();
    box.addChild(box._g);
    token.addChild(box);
    token[KEY] = box;
  }
  const g = box._g;
  g.clear();
  const r = Math.min(14, Math.max(9, w * 0.12));
  const gap = 7;
  const total = CAP * 2 * r + (CAP - 1) * gap;
  let x = (w - total) / 2 + r;
  for (let i = 0; i < CAP; i++) {
    pip(g, x, -r - 4, r, i < pts);
    x += 2 * r + gap;
  }
  box._pts = pts;
  box._w = w;
}

Hooks.on("refreshToken", (token) => { try { drawPips(token); } catch (e) { console.error(`${MOD} | overlay error`, e); } });
Hooks.on("destroyToken", (token) => { token[KEY]?.destroy?.({ children: true }); token[KEY] = null; });

/* ---------- Abilities and tracker on the character sheet ---------- */

const ABILITIES = {
  "combo-points": {
    name: "Combo Points",
    actionType: "passive",
    actions: null,
    img: "icons/skills/melee/blade-tip-orange.webp",
    desc: `<p>Once per round, when you successfully Strike an off-guard target, you gain 1 combo point, to a maximum of ${CAP}. You lose all combo points, and any unused Eviscerate, when the encounter ends.</p><p>Your points are tracked in the Combo points bar at the top of this sheet, on the diamonds above your token, and in the combo points panel (Alt+K).</p>`,
  },
  eviscerate: {
    name: "Eviscerate",
    actionType: "free",
    actions: null,
    img: "icons/skills/wounds/blood-cells-vessel-red.webp",
    desc: `<p><strong>Cost</strong> 1 or ${CAP} combo points</p><p>Spend 1 or ${CAP} combo points. Your next Strike deals an additional 1d6 precision damage for each combo point spent. Use the Eviscerate buttons in the Combo points bar on this sheet, or in the combo points panel.</p>`,
  },
};

async function ensureAbilities(actor) {
  if (!tracked(actor)) return;
  for (const [key, a] of Object.entries(ABILITIES)) {
    if (actor.items.some((i) => i.getFlag(MOD, "ability") === key)) continue;
    try {
      await actor.createEmbeddedDocuments("Item", [{
        type: "action",
        name: a.name,
        img: a.img,
        flags: { [MOD]: { ability: key } },
        system: {
          slug: key,
          actionType: { value: a.actionType },
          actions: { value: a.actions },
          category: "offensive",
          description: { value: a.desc },
        },
      }]);
    } catch (e) { console.error(`${MOD} | could not add ${a.name} to ${actor.name}`, e); }
  }
}

function sheetBarHTML(actor) {
  const pts = points(actor);
  const busy = !!primedEffect(actor);
  const pips = Array.from({ length: CAP }, (_, i) => `<span class="rcp-pip${i < pts ? " on" : ""}"></span>`).join("");
  const buttons = Array.from({ length: CAP }, (_, i) => i + 1).map((n) => {
    const ok = actor.isOwner && pts >= n && !busy;
    return `<button type="button" data-rcp-spend="${n}" data-actor="${actor.uuid}" ${ok ? "" : "disabled"}>Eviscerate ${n} (+${n}d6)</button>`;
  }).join("");
  return `<span class="rcp-label">Combo points</span><div class="rcp-pips">${pips}</div><span>${pts} / ${CAP}</span>${buttons}`;
}

Hooks.on("renderCharacterSheetPF2e", (sheet, html) => {
  const actor = sheet.actor;
  if (!tracked(actor)) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? sheet.element);
  if (!root?.querySelector) return;
  root.querySelector(".rcp-sheet")?.remove();
  const bar = document.createElement("div");
  bar.className = "rcp-sheet";
  bar.innerHTML = sheetBarHTML(actor);
  const anchor = root.querySelector("header.char-header") ?? root.querySelector("header");
  if (anchor) anchor.after(bar);
  else (root.querySelector(".window-content") ?? root).prepend(bar);
});

function onSpendClick(ev) {
  const btn = ev.target.closest?.("[data-rcp-spend]");
  if (!btn || btn.disabled) return;
  ev.preventDefault();
  const actor = fromUuidSync(btn.dataset.actor);
  if (actor) eviscerate(actor, Number(btn.dataset.rcpSpend));
}

/* ---------- Side panel ---------- */

class ComboPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MOD}-panel`,
    classes: ["rcp-panel"],
    tag: "div",
    window: { title: "Combo points", resizable: false },
    position: { width: 250 },
    actions: { eviscerate: ComboPanel.onEviscerate, adjust: ComboPanel.onAdjust },
  };

  get actor() {
    const picked = canvas?.tokens?.controlled?.map((t) => t.actor).find(tracked);
    return picked ?? (tracked(game.user.character) ? game.user.character : null);
  }

  static async onEviscerate(event, target) {
    const actor = this.actor;
    if (actor) await eviscerate(actor, Number(target.dataset.spend));
  }

  static async onAdjust(event, target) {
    const actor = this.actor;
    if (actor && game.user.isGM) await setPoints(actor, points(actor) + Number(target.dataset.delta));
  }

  async _prepareContext() {
    const actor = this.actor;
    if (!actor) return { actor: null };
    return { actor, pts: points(actor), primed: primedEffect(actor), owner: actor.isOwner };
  }

  async _renderHTML(c) {
    if (!c.actor) return `<p class="rcp-empty">Select your rogue's token to see combo points.</p>`;
    const pips = Array.from({ length: CAP }, (_, i) => `<span class="rcp-pip${i < c.pts ? " on" : ""}"></span>`).join("");
    const buttons = Array.from({ length: CAP }, (_, i) => i + 1).map((n) => {
      const ok = c.owner && c.pts >= n && !c.primed;
      return `<button type="button" data-action="eviscerate" data-spend="${n}" ${ok ? "" : "disabled"}>Eviscerate: spend ${n} (+${n}d6)</button>`;
    }).join("");
    const status = c.primed ? `${esc(c.primed.name)} is ready for your next Strike.` : "Spend points, then make your Strike.";
    const gm = game.user.isGM
      ? `<div class="rcp-gm"><button type="button" data-action="adjust" data-delta="-1">-1</button><button type="button" data-action="adjust" data-delta="1">+1</button></div>`
      : "";
    return `<div class="rcp-name">${esc(c.actor.name)}</div>
      <div class="rcp-row"><div class="rcp-pips">${pips}</div><span>${c.pts} / ${CAP}</span></div>
      <p class="rcp-status">${status}</p>
      <div class="rcp-buttons">${buttons}</div>${gm}`;
  }

  _replaceHTML(result, content) { content.innerHTML = result; }
}

let panel = null;
const openPanel = () => { panel ??= new ComboPanel(); return panel.render({ force: true }); };
const togglePanel = () => (panel?.rendered ? panel.close() : openPanel());
const refreshPanel = () => { if (panel?.rendered) panel.render(); };

async function toggleEnabled(actor) {
  const on = !actor.getFlag(MOD, "enabled");
  await actor.setFlag(MOD, "enabled", on);
  if (on) await ensureAbilities(actor);
  ui.notifications.info(`Combo points ${on ? "enabled" : "disabled"} for ${actor.name}.`);
}

Hooks.once("init", () => {
  game.settings.register(MOD, "debug", {
    name: "Debug logging",
    hint: "Log each attack the module sees (outcome, roll options, off-guard check) to the browser console.",
    scope: "client", config: true, type: Boolean, default: false,
  });
  game.keybindings.register(MOD, "toggle", {
    name: "Toggle combo points panel",
    editable: [{ key: "KeyK", modifiers: ["Alt"] }],
    onDown: () => { togglePanel(); return true; },
  });
});

Hooks.once("ready", () => {
  game.modules.get(MOD).api = { openPanel, togglePanel, eviscerate, toggleEnabled, ensureAbilities };
  document.addEventListener("click", onSpendClick);
  if (tracked(game.user.character)) openPanel();
  if (isActiveGM()) for (const actor of game.actors) ensureAbilities(actor);
});

Hooks.on("controlToken", refreshPanel);
Hooks.on("createItem", (item) => { if (item.slug === SLUG) refreshPanel(); });
Hooks.on("deleteItem", (item) => { if (item.slug === SLUG) refreshPanel(); });
Hooks.on("updateActor", (actor, changes) => {
  if (!foundry.utils.hasProperty(changes, FLAGS)) return;
  for (const t of actor.getActiveTokens()) { try { drawPips(t); } catch (e) { console.error(e); } }
  refreshPanel();
});

Hooks.on("createItem", (item) => {
  if (isActiveGM() && item.type === "class" && item.slug === "rogue" && item.parent) ensureAbilities(item.parent);
});
