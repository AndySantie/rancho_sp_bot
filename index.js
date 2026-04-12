const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const { stringify } = require('csv-stringify/sync');
const cfg = require('./config.json');
const path = require('path');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// =====================
// FILE STORAGE
// =====================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const depositsFile = path.join(dataDir, 'deposits.json');
const paymentsFile = path.join(dataDir, 'payments.json');
const pricesFile = path.join(dataDir, 'prices.json');
const panelsFile = path.join(dataDir, 'panels.json');
const employeesFile = path.join(dataDir, 'employees.json');
const weeklyFarmFile = path.join(dataDir, 'weekly_farm.json');
const weeklyStatusFile = path.join(dataDir, 'weekly_status.json');

const FALLBACK_AVISOS_CHANNEL_ID = '1477351720366637239';
const FALLBACK_CHAT_GERAL_CHANNEL_ID = '1477351882421829856';
const FALLBACK_FUNCIONARIO_ROLE_ID = '1477303771242430544';

function ensureFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf-8');
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

ensureFile(depositsFile, []);
ensureFile(paymentsFile, []);
ensureFile(pricesFile, {});
ensureFile(panelsFile, {});
ensureFile(employeesFile, []);
ensureFile(weeklyFarmFile, {});
ensureFile(weeklyStatusFile, []);

// =====================
// HELPERS
// =====================
function ymd(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowIso() {
  return new Date().toISOString();
}

function brDateFromYMD(s) {
  if (!s || typeof s !== 'string') return s;
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function safeNick(str) {
  return String(str || '').slice(0, 32);
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function isStaff(member) {
  const owner = cfg.roles?.ownerRoleId;
  const mgr = cfg.roles?.managerRoleId;
  return Boolean(
    (owner && member.roles.cache.has(owner)) ||
    (mgr && member.roles.cache.has(mgr))
  );
}

function channelMentionById(channelId) {
  return channelId ? `<#${channelId}>` : 'canal configurado';
}

function roleMentionById(roleId) {
  return roleId ? `<@&${roleId}>` : '';
}

async function findTextChannelByIdOrName(guild, id, names) {
  if (id) {
    const byId = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (byId && byId.isTextBased()) return byId;
  }

  const wanted = (Array.isArray(names) ? names : []).map(x => String(x || '').toLowerCase());
  return guild.channels.cache.find(ch => ch && ch.isTextBased?.() && wanted.includes(String(ch.name || '').toLowerCase())) || null;
}

async function getManagerPanelChannel(guild) {
  return findTextChannelByIdOrName(
    guild,
    cfg.channels?.managerPanelChannelId || cfg.channels?.painelGerenciaChannelId || cfg.channels?.gerenciaPanelChannelId || null,
    ['painel-gerencia', 'painel_gerencia']
  );
}

async function getAvisosChannel(guild) {
  return findTextChannelByIdOrName(
    guild,
    cfg.channels?.avisosChannelId || FALLBACK_AVISOS_CHANNEL_ID,
    ['avisos']
  );
}

async function getChatGeralChannel(guild) {
  return findTextChannelByIdOrName(
    guild,
    cfg.channels?.chatGeralChannelId || FALLBACK_CHAT_GERAL_CHANNEL_ID,
    ['chat-geral', 'chat_geral']
  );
}

function getEmployeeRoleId() {
  return cfg.roles?.employeeRoleId || FALLBACK_FUNCIONARIO_ROLE_ID;
}

// =====================
// DATA ACCESS
// =====================
function loadDeposits() { return readJson(depositsFile, []); }
function saveDeposits(d) { writeJson(depositsFile, d); }

function loadEmployees() {
  return readJson(employeesFile, []);
}

function saveEmployees(data) {
  writeJson(employeesFile, data);
}

function loadWeeklyFarm() {
  const data = readJson(weeklyFarmFile, {});
  return data && typeof data === 'object' ? data : {};
}

function saveWeeklyFarm(data) {
  writeJson(weeklyFarmFile, data || {});
}

function loadWeeklyStatus() {
  const data = readJson(weeklyStatusFile, []);
  return Array.isArray(data) ? data : [];
}

function saveWeeklyStatus(data) {
  writeJson(weeklyStatusFile, Array.isArray(data) ? data : []);
}

function startOfWeekMonday(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeekSunday(date = new Date()) {
  const d = startOfWeekMonday(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getISOWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function getCurrentWeekInfo() {
  const now = new Date();
  const start = startOfWeekMonday(now);
  const end = endOfWeekSunday(now);
  const iso = getISOWeekInfo(now);
  return {
    weekId: `${iso.year}-W${String(iso.week).padStart(2, '0')}`,
    startDate: ymd(start),
    endDate: ymd(end)
  };
}

function parseYMDToLocalDate(s) {
  if (!s || typeof s !== 'string') return null;
  const [year, month, day] = s.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getWeekdayNumberFromYMD(s) {
  const d = parseYMDToLocalDate(s);
  if (!d) return null;
  return d.getDay();
}

function buildWeeklyStatusFromEmployees(employees, weekInfo) {
  const now = nowIso();
  const start = parseYMDToLocalDate(weekInfo.startDate);
  const end = parseYMDToLocalDate(weekInfo.endDate);
  if (!start || !end) return [];
  end.setHours(23, 59, 59, 999);

  return (Array.isArray(employees) ? employees : []).map(emp => {
    const joined = parseYMDToLocalDate(emp.dataEntrada);
    const enteredThisWeek = joined && joined >= start && joined <= end;
    const weekday = joined ? joined.getDay() : null;
    const autoExempt = Boolean(enteredThisWeek && weekday !== null && weekday >= 3);

    return {
      userId: emp.userId,
      nome: emp.nome || '',
      vulgo: emp.vulgo || '',
      weekId: weekInfo.weekId,
      dataEntrada: emp.dataEntrada || null,
      isento: autoExempt || Boolean(emp.isentoManual),
      tipoIsencao: emp.isentoManual ? 'manual' : (autoExempt ? 'automatica' : null),
      motivo: emp.isentoManual
        ? 'Isenção manual cadastrada em employees.json'
        : (autoExempt ? 'Entrou na semana a partir de quarta-feira' : null),
      marcadoEm: (autoExempt || emp.isentoManual) ? now : null
    };
  });
}

function weeklyItemsText(farmData) {
  const items = Array.isArray(farmData?.items) ? farmData.items : [];
  return items.length
    ? items.map(item => `• **${item.nome}**: ${item.quantidade}`).join('\n')
    : '• Nenhum item cadastrado';
}

function formatWeeklyFarmOfficialPost(farmData) {
  return [
    '🌾 **FARM SEMANAL — HARAS RANCHO SP**',
    `📅 **Semana:** ${brDateFromYMD(farmData.startDate)} até ${brDateFromYMD(farmData.endDate)}`,
    '',
    '📦 **Itens obrigatórios**',
    weeklyItemsText(farmData),
    '',
    '📝 **Observações**',
    farmData.observacoes || 'Sem observações.',
    '',
    roleMentionById(getEmployeeRoleId())
  ].join('\n');
}

function formatWeeklyFarmGeneralNotice(avisosChannelId) {
  return [
    '🌾 A meta semanal do Haras Rancho SP foi atualizada em ' + channelMentionById(avisosChannelId) + '.',
    '',
    `${roleMentionById(getEmployeeRoleId())}, confiram os itens obrigatórios da semana.`
  ].join('\n');
}

function formatWeeklyFarmFolderPost(farmData) {
  return [
    '🌾 **META SEMANAL DO HARAS**',
    `📅 **Semana:** ${brDateFromYMD(farmData.startDate)} até ${brDateFromYMD(farmData.endDate)}`,
    '',
    '📦 **Itens obrigatórios**',
    weeklyItemsText(farmData),
    '',
    '📝 **Observações**',
    farmData.observacoes || 'Sem observações.'
  ].join('\n');
}

function formatWeeklyFarmSummary(farmData, weeklyStatus) {
  const items = Array.isArray(farmData.items) ? farmData.items : [];
  const itemLines = items.length
    ? items.map(item => `• **${item.nome}**: ${item.quantidade}`).join('\n')
    : '• Nenhum item cadastrado';

  const autoExempt = (Array.isArray(weeklyStatus) ? weeklyStatus : []).filter(x => x.tipoIsencao === 'automatica');
  const exemptText = autoExempt.length
    ? autoExempt.map(x => `• **${x.nome || x.vulgo || x.userId}**${x.dataEntrada ? ` — entrou em ${brDateFromYMD(x.dataEntrada)}` : ''}`).join('\n')
    : '• Nenhum funcionário entrou a partir de quarta nesta semana.';

  return (
    `✅ **FARM semanal cadastrado com sucesso!**\n\n` +
    `📅 **Semana:** ${brDateFromYMD(farmData.startDate)} até ${brDateFromYMD(farmData.endDate)}\n` +
    `🆔 **ID da semana:** ${farmData.weekId}\n\n` +
    `📦 **Itens obrigatórios**\n${itemLines}\n\n` +
    `📝 **Observações**\n${farmData.observacoes || 'Sem observações.'}\n\n` +
    `⚠️ **Isenção automática detectada**\n${exemptText}`
  );
}

function ensureEmployee(user) {
  const employees = loadEmployees();

  const exists = employees.find(e => e.userId === user.id);
  if (exists) return;

  employees.push({
    userId: user.id,
    nome: user.username,
    dataEntrada: ymd(),
    isentoManual: false
  });

  saveEmployees(employees);
}

function loadPayments() { return readJson(paymentsFile, []); }
function savePayments(d) { writeJson(paymentsFile, d); }

function loadPrices() { return readJson(pricesFile, {}); }
function savePrices(d) { writeJson(pricesFile, d); }

function getItem(key) {
  return (cfg.items || []).find(i => i.key === key);
}

function getPriceMap() {
  const map = {};
  for (const it of (cfg.items || [])) map[it.key] = Number(it.price || 0);
  const override = loadPrices();
  for (const k of Object.keys(override || {})) map[k] = Number(override[k]);
  return map;
}

function setPrice(key, value) {
  const p = loadPrices();
  p[key] = Number(value);
  savePrices(p);
}

// =====================
// STATUS
// ABERTO | PAGO | CANCELADO
// =====================
function validDeposits(deposits) {
  return deposits.filter(d => d.status !== 'CANCELADO');
}

function totalsByUser(guildId, userId, { onlyOpen = false } = {}) {
  const deposits = validDeposits(loadDeposits())
    .filter(d => d.guildId === guildId && d.userId === userId);

  const filtered = onlyOpen ? deposits.filter(d => d.status === 'ABERTO') : deposits;

  const map = {};
  for (const d of filtered) map[d.itemKey] = (map[d.itemKey] || 0) + d.qty;
  return map;
}

function totalsDay(guildId, day) {
  const deposits = validDeposits(loadDeposits())
    .filter(d => d.guildId === guildId && d.day === day);

  const byUser = new Map();
  for (const d of deposits) {
    const key = `${d.userId}|${d.userTag}`;
    if (!byUser.has(key)) byUser.set(key, {});
    const obj = byUser.get(key);
    obj[d.itemKey] = (obj[d.itemKey] || 0) + d.qty;
  }
  return byUser;
}

function computePayment(guildId, userId) {
  const prices = getPriceMap();
  const deposits = validDeposits(loadDeposits())
    .filter(d => d.guildId === guildId && d.userId === userId && d.status === 'ABERTO');

  const itemTotals = {};
  const itemMoney = {};
  let grand = 0;

  for (const d of deposits) {
    const price = Number(prices[d.itemKey] ?? 0);
    itemTotals[d.itemKey] = (itemTotals[d.itemKey] || 0) + d.qty;
    itemMoney[d.itemKey] = (itemMoney[d.itemKey] || 0) + (d.qty * price);
    grand += d.qty * price;
  }

  return { itemTotals, itemMoney, grand };
}

// =====================
// RANKING (semana | mes | geral)
// =====================
function withinPeriod(deposit, period) {
  if (period === 'geral') return true;
  const t = new Date(deposit.createdAt || deposit.day || nowIso()).getTime();
  const now = Date.now();
  const days = period === 'semana' ? 7 : 30;
  return (now - t) <= days * 24 * 60 * 60 * 1000;
}

function computeRanking(guildId, period, itemKeyOrNull) {
  const deposits = validDeposits(loadDeposits())
    .filter(d => d.guildId === guildId && withinPeriod(d, period));

  const map = new Map(); // userTag -> total
  for (const d of deposits) {
    if (itemKeyOrNull && d.itemKey !== itemKeyOrNull) continue;
    map.set(d.userTag, (map.get(d.userTag) || 0) + d.qty);
  }

  return Array.from(map.entries())
    .map(([tag, total]) => ({ tag, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

// =====================
// LOGS
// =====================
async function sendDepositLog(interaction, text) {
  const logChId = cfg.channels?.logChannelId;
  if (!logChId) return;
  const logCh = await interaction.guild.channels.fetch(logChId).catch(() => null);
  if (!logCh) return;
  await logCh.send(`${text}\n${SEP}`);
}

async function sendPaymentLog(interaction, text) {
  const payChId = cfg.channels?.logPaymentsChannelId || cfg.channels?.logChannelId;
  if (!payChId) return;
  const logCh = await interaction.guild.channels.fetch(payChId).catch(() => null);
  if (!logCh) return;
  await logCh.send(`${text}\n${SEP}`);
}

// =====================
// THREADS (FARM)
// =====================
async function getOrCreatePrivateThread(interaction) {
  ensureEmployee(interaction.user);

  const hubId = cfg.channels?.farmHubChannelId;
  if (!hubId) throw new Error('farmHubChannelId não configurado.');

  const hub = await interaction.guild.channels.fetch(hubId);
  const threadName = `${cfg.threads?.namePrefix || 'farm-'}${interaction.user.username}`.toLowerCase();

  const active = await hub.threads.fetchActive();
  const existing = active.threads.find(t => t.name === threadName);
  if (existing) return existing;

  const t = await hub.threads.create({
    name: threadName,
    type: ChannelType.PrivateThread,
    autoArchiveDuration: cfg.threads?.autoArchiveMinutes || 10080,
    reason: 'Pasta privada de FARM'
  });

  await t.members.add(interaction.user.id);

  await t.send(
    `👋 **Pasta privada criada!**\n\n` +
    `📸 Envie o print do farm nesta pasta. (da sua mochila com os produtos, e do baú do Haras)\n` +
    `Depois disso, o botão para continuar o registro aparecerá abaixo.\n\n` +
    `⏱️ Print válido por **${cfg.proof?.maxMinutesSinceProof ?? 5} minutos**.`
  );

  return t;
}

async function getLatestProofMessage(thread, userId, maxMinutes) {
  const msgs = await thread.messages.fetch({ limit: 30 });
  const maxMs = maxMinutes * 60 * 1000;

  const proof = msgs
    .filter(m =>
      m.author?.id === userId &&
      m.attachments?.size &&
      (Date.now() - m.createdTimestamp) <= maxMs
    )
    .first();

  if (!proof) return null;

  const att = proof.attachments.first();
  if (!att) return null;

  return { id: proof.id, url: att.url };
}

function isProofUsed(guildId, messageId) {
  const deposits = loadDeposits();
  return deposits.some(x => x.guildId === guildId && x.proofMessageId === messageId && x.status !== 'CANCELADO');
}


async function startArmazenarFlow(interaction, replyMode = 'edit') {
  const thread = await getOrCreatePrivateThread(interaction);

  if (interaction.channelId !== thread.id) {
    const msg = `⚠️ Use o registro dentro da sua pasta: ${thread.toString()}`;
    if (replyMode === 'reply') return interaction.reply({ content: msg, flags: 64 });
    return interaction.editReply(msg);
  }

  const proofMsg = await getLatestProofMessage(thread, interaction.user.id, cfg.proof?.maxMinutesSinceProof ?? 5);
  if (!proofMsg) {
    const msg = `📸 Anexe um print dos últimos ${(cfg.proof?.maxMinutesSinceProof ?? 5)} min e tente novamente.`;
    if (replyMode === 'reply') return interaction.reply({ content: msg, flags: 64 });
    return interaction.editReply(msg);
  }

  if (isProofUsed(interaction.guildId, proofMsg.id)) {
    const msg = '⚠️ Esse print já foi usado. Anexe um print novo e tente novamente.';
    if (replyMode === 'reply') return interaction.reply({ content: msg, flags: 64 });
    return interaction.editReply(msg);
  }

  session.set(interaction.user.id, {
    threadId: thread.id,
    proofUrl: proofMsg.url,
    proofMessageId: proofMsg.id,
    itemKey: null,
    qty: null
  });

  const payload = {
    content: `O que você está registrando?\n✅ Print detectado com sucesso.`,
    components: [itemsMenu()]
  };

  if (replyMode === 'reply') {
    return interaction.reply({ ...payload, flags: 64 });
  }
  return interaction.editReply(payload);
}

// NOVO: achar pasta por usuário (staff)
async function findFarmThreadByUser(guild, user) {
  const hubId = cfg.channels?.farmHubChannelId;
  if (!hubId) return null;

  const hub = await guild.channels.fetch(hubId).catch(() => null);
  if (!hub) return null;

  const threadName = `${cfg.threads?.namePrefix || 'farm-'}${user.username}`.toLowerCase();

  // tenta ativo
  const active = await hub.threads.fetchActive().catch(() => null);
  const existingActive = active?.threads?.find(t => t.name === threadName);
  if (existingActive) return existingActive;

  // tenta arquivadas recentes
  const archived = await hub.threads.fetchArchived({ limit: 100 }).catch(() => null);
  const existingArchived = archived?.threads?.find(t => t.name === threadName);
  if (existingArchived) return existingArchived;

  return null;
}

// =====================
// UI (armazenar)
// =====================
function itemsMenu() {
  const options = (cfg.items || []).map(it => ({
    label: it.label,
    value: it.key,
    description: `Preço: ${money(Number(getPriceMap()[it.key] || 0))}`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('armazenar_select_item')
    .setPlaceholder('Selecione o material...')
    .addOptions(options.slice(0, 25));

  return new ActionRowBuilder().addComponents(menu);
}

function qtyModal(itemKey) {
  const label = getItem(itemKey)?.label || itemKey;

  const modal = new ModalBuilder()
    .setCustomId(`armazenar_qty_modal:${itemKey}`)
    .setTitle(`Quantidade — ${label}`);

  const input = new TextInputBuilder()
    .setCustomId('qty')
    .setLabel('Digite a quantidade armazenada')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: 50');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function confirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('armazenar_confirmar')
      .setLabel('Confirmar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('armazenar_cancelar')
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Danger)
  );
}

function weeklyFarmManagerButtonsRowOne() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('weekly_farm_open_modal')
      .setLabel('Cadastrar FARM Semanal')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('weekly_farm_view_current')
      .setLabel('Ver Preview FARM')
      .setStyle(ButtonStyle.Primary)
  );
}

function weeklyFarmManagerButtonsRowTwo() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('weekly_farm_publish_avisos')
      .setLabel('Publicar em Avisos')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('weekly_farm_publish_chat_geral')
      .setLabel('Avisar no Chat Geral')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('weekly_farm_send_folders')
      .setLabel('Enviar para Pastas Farm')
      .setStyle(ButtonStyle.Secondary)
  );
}

function weeklyFarmModal() {
  const modal = new ModalBuilder()
    .setCustomId('weekly_farm_modal_submit')
    .setTitle('Cadastrar FARM Semanal');

  const plantas = new TextInputBuilder()
    .setCustomId('weekly_plantas')
    .setLabel('Quantidade de Plantas')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: 600');

  const madeiras = new TextInputBuilder()
    .setCustomId('weekly_madeiras')
    .setLabel('Quantidade de Madeiras')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: 100');

  const fibras = new TextInputBuilder()
    .setCustomId('weekly_fibras')
    .setLabel('Quantidade de Fibras')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: 100');

  const observacoes = new TextInputBuilder()
    .setCustomId('weekly_observacoes')
    .setLabel('Descrição / Observações')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder('Ex: Semana normal de produção.');

  modal.addComponents(
    new ActionRowBuilder().addComponents(plantas),
    new ActionRowBuilder().addComponents(madeiras),
    new ActionRowBuilder().addComponents(fibras),
    new ActionRowBuilder().addComponents(observacoes)
  );

  return modal;
}

function weeklyFarmReplaceButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('weekly_farm_replace_confirm')
      .setLabel('Substituir cadastro da semana')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('weekly_farm_replace_cancel')
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );
}

// =====================
// PAINÉIS AUTOMÁTICOS (igual #registro)
// =====================
function loadPanels() {
  const p = readJson(panelsFile, {});
  return p && typeof p === 'object' ? p : {};
}

function savePanels(p) {
  writeJson(panelsFile, p || {});
}

async function upsertPanelMessage({ key, channelId, content, components, contentHint = null }) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const panels = loadPanels();
  const old = panels[key];

  let msg = null;
  if (old?.messageId) {
    msg = await channel.messages.fetch(old.messageId).catch(() => null);
  }

  if (!msg && contentHint) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    msg = recent?.find?.(m => m.author?.id === client.user?.id && typeof m.content === 'string' && m.content.includes(contentHint)) || null;
  }

  if (msg) {
    await msg.edit({ content, components }).catch(() => null);
  } else {
    msg = await channel.send({ content, components });
    panels[key] = { channelId, messageId: msg.id };
    savePanels(panels);
  }

  // tenta fixar
  await msg.pin().catch(() => {});
}

function registerButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('register_employee_open_modal')
      .setLabel('Registrar')
      .setStyle(ButtonStyle.Primary)
  );
}

function registerModal() {
  const modal = new ModalBuilder()
    .setCustomId('register_modal_submit')
    .setTitle('Registro — HARAS RANCHO SP');

  const rpName = new TextInputBuilder()
    .setCustomId('rp_name')
    .setLabel('Nome do personagem (RP)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: João Ferraz');

  const bagId = new TextInputBuilder()
    .setCustomId('bag_id')
    .setLabel('Bolsa (ID)')
    .setPlaceholder('Digite o número que aparece no seu inventário')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Ex: 1024');

  modal.addComponents(
    new ActionRowBuilder().addComponents(rpName),
    new ActionRowBuilder().addComponents(bagId)
  );

  return modal;
}

async function ensureRegisterPanel() {
  const channelId = cfg.channels?.registerChannelId;
  if (!channelId) return;

  const text =
    '📌 **REGISTRO AUTOMÁTICO — HARAS RANCHO SP**\n' +
    'Clique no botão abaixo e preencha:\n' +
    '• **Nome do personagem (RP)**\n' +
    '• **Bolsa (ID - o numero que aparece no seu iventário)**\n\n' +
    'Após enviar, você receberá o cargo **Funcionário** e seu nick será ajustado.';

  await upsertPanelMessage({
    key: 'register',
    channelId,
    content: text,
    components: [registerButtonRow()]
  });
}

async function ensureFarmGuidePanel() {
  const channelId = cfg.channels?.registrosFarmChannelId;
  if (!channelId) return;

  const mins = cfg.proof?.maxMinutesSinceProof ?? 5;

  const text = [
    '📌 **COMO REGISTRAR FARM (PASSO A PASSO)**',
    '1) Use o botão **Criar Pasta Farm** abaixo para abrir sua pasta privada',
    '2) Dentro da sua pasta, **anexe um PRINT** do inventário/baú (obrigatório)',
    '3) Depois do print, clique em **Registrar Farm** para continuar',
    '4) Selecione o item e informe a quantidade para concluir o registro',
    '',
    '⚠️ **Regras rápidas**',
    `• Print vale **${mins} minutos**`,
    '• Print **não pode** ser reutilizado',
    '• Se errar, chame a gerência',
    '',
    '📋 **Meta semanal**',
    '• A meta da semana fica no **#painel-gerencia** e depois pode ser enviada para as pastas.'
  ].join('\n');

  await upsertPanelMessage({
    key: 'farm_guide',
    channelId,
    content: text,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('create_farm_folder')
          .setLabel('Criar Pasta Farm')
          .setStyle(ButtonStyle.Primary)
      )
    ],
    contentHint: 'COMO REGISTRAR FARM'
  });
}

async function ensureManagerPanel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const channel = await getManagerPanelChannel(guild);
  if (!channel) return;

  const text = [
    '📊 **PAINEL DE GERÊNCIA — HARAS RANCHO SP**',
    '',
    'Use esta área para definir, revisar e publicar o **FARM semanal** sem precisar digitar comandos.',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '🌾 **FARM SEMANAL**',
    '• **Cadastrar FARM Semanal**: cria ou substitui a meta da semana atual',
    '• **Ver Preview FARM**: mostra a semana ativa e as isenções automáticas detectadas',
    '• **Publicar em Avisos**: envia o comunicado oficial e marca o cargo Funcionário',
    '• **Avisar no Chat Geral**: manda o aviso curto puxando o pessoal para #avisos',
    '• **Enviar para Pastas Farm**: publica a meta nas pastas privadas já existentes',
    '━━━━━━━━━━━━━━━━━━',
    '📌 Os demais controles atuais da gerência podem continuar sendo usados normalmente.'
  ].join('\n');

  await upsertPanelMessage({
    key: 'manager_panel',
    channelId: channel.id,
    content: text,
    components: [weeklyFarmManagerButtonsRowOne(), weeklyFarmManagerButtonsRowTwo()],
    contentHint: 'PAINEL DE GERÊNCIA'
  });
}

// =====================
// RANKING AUTO (painel fixo em #ranking-farm)
// =====================
async function upsertRankingPanel() {
  const channelId = cfg.channels?.rankingChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const panels = loadPanels();
  const key = 'ranking_panel';
  const old = panels[key];

  let msg = null;
  if (old?.messageId) {
    msg = await channel.messages.fetch(old.messageId).catch(() => null);
  }

  const topLimit = Number(cfg.ranking?.topLimit || 10);

  function fmt(list) {
    if (!list || !list.length) return 'Sem registros suficientes ainda.';
    return list.slice(0, topLimit).map((x, i) => `**${i + 1}.** ${x.tag} — **${x.total}**`).join('\n');
  }

  const week = computeRanking(channel.guild.id, 'semana', null);
  const month = computeRanking(channel.guild.id, 'mes', null);
  const all = computeRanking(channel.guild.id, 'geral', null);

  const embed = new EmbedBuilder()
    .setTitle('🏆 Ranking — HARAS RANCHO SP')
    .setDescription('Farming • atualizado automaticamente')
    .addFields(
      { name: '🏅 Top Semana (7 dias)', value: fmt(week), inline: true },
      { name: '🥇 Top Mês (30 dias)', value: fmt(month), inline: true },
      { name: '📜 Top Geral', value: fmt(all), inline: true }
    )
    .setFooter({ text: 'Rancho SP • Ranking' })
    .setTimestamp(new Date());

  // logo opcional
  const logoPath = path.join(__dirname, 'assets', 'ranchosp.png');
  const hasLogo = fs.existsSync(logoPath);
  const files = [];

  if (hasLogo) {
    embed.setThumbnail('attachment://ranchosp.png');
    files.push(new AttachmentBuilder(logoPath));
  }

  if (msg) {
    await msg.edit({ embeds: [embed], files }).catch(() => null);
  } else {
    msg = await channel.send({ embeds: [embed], files }).catch(() => null);
    if (!msg) return;
    panels[key] = { channelId, messageId: msg.id };
    savePanels(panels);
  }

  await msg.pin().catch(() => {});
}

let rankingInterval = null;

function startRankingScheduler() {
  const mins = Number(cfg.ranking?.updateMinutes || 10);
  // atualiza agora
  upsertRankingPanel().catch(() => null);

  if (rankingInterval) clearInterval(rankingInterval);
  rankingInterval = setInterval(() => {
    upsertRankingPanel()
      .then(() => console.log('✅ Ranking atualizado'))
      .catch((e) => console.error('❌ Ranking update error:', e));
  }, mins * 60 * 1000);
}

// =====================
// BOAS-VINDAS (EMBED VINTAGE + LOGO)
// =====================
async function sendWelcome(member) {
  // 1) tenta ID no config; 2) tenta por nome "boas-vindas"
  let ch = null;

  const byId = cfg.channels?.welcomeChannelId;
  if (byId && String(byId).trim()) {
    ch = await member.guild.channels.fetch(byId).catch(() => null);
  }
  if (!ch) {
    ch = member.guild.channels.cache.find(c =>
      c && c.type === ChannelType.GuildText && (c.name === 'boas-vindas' || c.name === 'boas vindas')
    ) || null;
  }

  if (!ch) return;

  const logoPath = path.join(__dirname, 'assets', 'ranchosp.png');
  const hasLogo = fs.existsSync(logoPath);
  const attachment = hasLogo ? new AttachmentBuilder(logoPath) : null;

  let vulgo = null;

try {
  const employees = readJson(employeesFile, []);
  const found = employees.find(e => e.userId === member.id);
  if (found) vulgo = found.vulgo;
} catch {}


  const embed = new EmbedBuilder()
 .setDescription(
  `Seja bem-vindo(a), ${member}!\n` +
  (vulgo ? `\n📛 **Vulgo:** ${vulgo}\n` : '\n') +
  `\n📌 **Primeiro passo**\n` +
  `• Vá em **#registro** e clique em **Registrar**\n\n` +
  `📦 **Farm (Funcionários)**\n` +
  `• Leia o passo a passo em **#registros-farm**\n\n` +
  `🧭 **Dica rápida**\n` +
  `• Qualquer dúvida, fale com a **Gerência**.\n\n` +
  `_${SEP}_`
)
    .setFooter({ text: 'Rancho SP • RedM Server' })
    .setTimestamp(new Date());

  if (attachment) {
    embed.setThumbnail('attachment://ranchosp.png');
  }

  await ch.send({
    content: `🤠 ${member.user.username} chegou no rancho!`,
    embeds: [embed],
    files: attachment ? [attachment] : []
  }).catch(() => {});
}

// =====================
// READY
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await ensureRegisterPanel();
  await ensureFarmGuidePanel();
  await ensureManagerPanel();
  // await ensureCommandsPanel();
  startRankingScheduler();
});

// =====================
// EVENT: MEMBER JOIN
// =====================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await sendWelcome(member);
  } catch (e) {
    console.error('Welcome error:', e);
  }
});

async function publishWeeklyFarmToAvisos(guild) {
  const current = loadWeeklyFarm();
  if (!current?.weekId) return { ok: false, message: '⚠️ Ainda não existe FARM semanal cadastrado.' };

  const channel = await getAvisosChannel(guild);
  if (!channel) return { ok: false, message: '⚠️ Canal #avisos não encontrado/configurado.' };

  await channel.send({ content: formatWeeklyFarmOfficialPost(current) });
  return { ok: true, message: `✅ FARM semanal publicado em ${channel.toString()}.`, channelId: channel.id };
}

async function publishWeeklyFarmToChatGeral(guild) {
  const current = loadWeeklyFarm();
  if (!current?.weekId) return { ok: false, message: '⚠️ Ainda não existe FARM semanal cadastrado.' };

  const channel = await getChatGeralChannel(guild);
  if (!channel) return { ok: false, message: '⚠️ Canal #chat-geral não encontrado/configurado.' };

  const avisos = await getAvisosChannel(guild);
  await channel.send({ content: formatWeeklyFarmGeneralNotice(avisos?.id || cfg.channels?.avisosChannelId || FALLBACK_AVISOS_CHANNEL_ID) });
  return { ok: true, message: `✅ Aviso curto enviado em ${channel.toString()}.`, channelId: channel.id };
}

async function publishWeeklyFarmToFolders(guild) {
  const current = loadWeeklyFarm();
  if (!current?.weekId) return { ok: false, message: '⚠️ Ainda não existe FARM semanal cadastrado.' };

  const channels = guild.channels.cache.filter(ch =>
    ch && ch.type === ChannelType.GuildText && String(ch.name || '').toLowerCase().startsWith('farm-')
  );

  if (!channels.size) return { ok: false, message: '⚠️ Não encontrei pastas farm para enviar.' };

  let sent = 0;
  for (const [, ch] of channels) {
    const ok = await ch.send({ content: formatWeeklyFarmFolderPost(current) }).then(() => true).catch(() => false);
    if (ok) sent += 1;
  }

  return { ok: sent > 0, message: sent > 0 ? `✅ Meta semanal enviada para **${sent}** pasta(s) farm.` : '⚠️ Não consegui enviar para nenhuma pasta farm.' };
}

// =====================
// MAIN
// =====================
const session = new Map();
const weeklyFarmPendingReplace = new Map();

client.on(Events.InteractionCreate, async (interaction) => {
  try {


// =====================
// REGISTRO (botão + modal)
// =====================
if (interaction.isButton() && interaction.customId === 'register_employee_open_modal') {
  try {
    return await interaction.showModal(registerModal());
  } catch (err) {
    console.error('Erro ao abrir modal:', err);
  }
}

// =====================
// BOTÃO CRIAR PASTA FARM
// =====================
if (interaction.isButton() && interaction.customId === 'create_farm_folder') {
  await interaction.reply({
    content: "📁 Criando sua pasta...",
    flags: 64
  });

  const thread = await getOrCreatePrivateThread(interaction);
  return interaction.editReply(`✅ Sua pasta: ${thread.toString()}`);
}

// =====================
// BOTÃO REGISTRAR FARM
// =====================
if (interaction.isButton() && interaction.customId === 'register_farm') {
  return startArmazenarFlow(interaction, 'reply');
}

// =====================
// FARM SEMANAL (GERÊNCIA)
// =====================
if (interaction.isButton() && interaction.customId === 'weekly_farm_open_modal') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  return interaction.showModal(weeklyFarmModal());
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_view_current') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const current = loadWeeklyFarm();
  if (!current?.weekId) {
    return interaction.reply({ content: '⚠️ Ainda não existe FARM semanal cadastrado.', flags: 64 });
  }

  const status = loadWeeklyStatus().filter(x => x.weekId === current.weekId);
  return interaction.reply({ content: formatWeeklyFarmSummary(current, status), flags: 64 });
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_publish_avisos') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const result = await publishWeeklyFarmToAvisos(interaction.guild);
  return interaction.reply({ content: result.message, flags: 64 });
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_publish_chat_geral') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const result = await publishWeeklyFarmToChatGeral(interaction.guild);
  return interaction.reply({ content: result.message, flags: 64 });
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_send_folders') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const result = await publishWeeklyFarmToFolders(interaction.guild);
  return interaction.reply({ content: result.message, flags: 64 });
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_replace_cancel') {
  weeklyFarmPendingReplace.delete(interaction.user.id);
  return interaction.reply({ content: '❌ Substituição do FARM semanal cancelada.', flags: 64 });
}

if (interaction.isButton() && interaction.customId === 'weekly_farm_replace_confirm') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const pending = weeklyFarmPendingReplace.get(interaction.user.id);
  if (!pending) {
    return interaction.reply({ content: '⚠️ Não encontrei um cadastro pendente para substituir.', flags: 64 });
  }

  saveWeeklyFarm(pending.farmData);
  saveWeeklyStatus(pending.weeklyStatus);
  weeklyFarmPendingReplace.delete(interaction.user.id);

  return interaction.reply({ content: formatWeeklyFarmSummary(pending.farmData, pending.weeklyStatus), flags: 64 });
}

// =====================
// ENVIO DO FORMULÁRIO (REGISTRO)
// =====================
if (interaction.isModalSubmit() && interaction.customId === 'register_modal_submit') {

  await interaction.reply({
    content: "⏳ Processando registro...",
    flags: 64
  });

  const rp = interaction.fields.getTextInputValue('rp_name').trim();
  const bag = interaction.fields.getTextInputValue('bag_id').trim();

  if (!rp || rp.length < 3) return interaction.editReply('❌ Nome RP inválido.');
  if (!bag || bag.length < 1 || bag.length > 20) return interaction.editReply('❌ Bolsa (ID) inválida.');

  const roleId = cfg.roles?.employeeRoleId;
  if (!roleId) return interaction.editReply('⚠️ employeeRoleId não configurado no config.json.');

  const member = interaction.member;
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) return interaction.editReply('⚠️ Cargo Funcionário não encontrado (roleId inválido).');

  try {
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'Registro automático (bot)');
    }
  } catch (e) {
    console.error(e);
    return interaction.editReply('❌ Não consegui dar o cargo.');
  }

  const nick = safeNick(`${interaction.user.username} (vulgo ${rp} - ${bag})`);

  if (interaction.guild.members.me.permissions.has("ManageNicknames")) {
    try {
      await member.setNickname(nick, 'Registro automático (bot)');
    } catch {}
  }

  // 🔥 SALVAR FUNCIONÁRIO
  try {
    const employees = readJson(employeesFile, []);

    const exists = employees.find(e => e.userId === interaction.user.id);

    if (!exists) {
      employees.push({
        userId: interaction.user.id,
        nome: interaction.user.username,
        vulgo: rp,
        dataEntrada: ymd(),
        isentoManual: false
      });

      writeJson(employeesFile, employees);
    }
  } catch (err) {
    console.error("Erro ao salvar employee:", err);
  }

  return interaction.editReply(
    `✅ Registrado com sucesso!\n• Cargo: **Funcionário**\n• Nick: **${nick}**`
  );
}

// =====================
// MODAL FARM SEMANAL
// =====================
if (interaction.isModalSubmit() && interaction.customId === 'weekly_farm_modal_submit') {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
  }

  const plantas = Number(interaction.fields.getTextInputValue('weekly_plantas').trim());
  const madeiras = Number(interaction.fields.getTextInputValue('weekly_madeiras').trim());
  const fibras = Number(interaction.fields.getTextInputValue('weekly_fibras').trim());
  const observacoes = interaction.fields.getTextInputValue('weekly_observacoes').trim();

  const nums = [plantas, madeiras, fibras];
  if (nums.some(n => !Number.isInteger(n) || n <= 0 || n > 1000000)) {
    return interaction.reply({ content: '❌ Preencha Plantas, Madeiras e Fibras com números inteiros maiores que 0.', flags: 64 });
  }

  const weekInfo = getCurrentWeekInfo();
  const farmData = {
    weekId: weekInfo.weekId,
    startDate: weekInfo.startDate,
    endDate: weekInfo.endDate,
    createdAt: nowIso(),
    createdBy: interaction.user.id,
    items: [
      { nome: 'Plantas', quantidade: plantas },
      { nome: 'Madeiras', quantidade: madeiras },
      { nome: 'Fibras', quantidade: fibras }
    ],
    observacoes: observacoes || '',
    status: 'ativo'
  };

  const weeklyStatus = buildWeeklyStatusFromEmployees(loadEmployees(), weekInfo);
  const current = loadWeeklyFarm();

  if (current?.weekId === weekInfo.weekId) {
    weeklyFarmPendingReplace.set(interaction.user.id, { farmData, weeklyStatus });
    return interaction.reply({
      content:
        `⚠️ Já existe um FARM semanal cadastrado para **${weekInfo.weekId}**.\n\n` +
        `Se quiser trocar, clique em **Substituir cadastro da semana**.`,
      components: [weeklyFarmReplaceButtons()],
      flags: 64
    });
  }

  saveWeeklyFarm(farmData);
  saveWeeklyStatus(weeklyStatus);

  return interaction.reply({
    content: formatWeeklyFarmSummary(farmData, weeklyStatus) + '\n\n📌 Depois use o **#painel-gerencia** para publicar em avisos, chat geral ou pastas farm.',
    flags: 64
  });
}

// =====================
    // SLASH COMMANDS
    // =====================
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      if (cmd === 'minha_pasta') {
        await interaction.deferReply({ flags: 64 });

        ensureEmployee(interaction.user);

        const thread = await getOrCreatePrivateThread(interaction);

        return interaction.editReply(`✅ Sua pasta: ${thread.toString()}`);
      }

      if (cmd === 'armazenar') {
        await interaction.deferReply({ flags: 64 });

        const thread = await getOrCreatePrivateThread(interaction);

        if (interaction.channelId !== thread.id) {
          return interaction.editReply(`⚠️ Use /armazenar dentro da sua pasta: ${thread.toString()}`);
        }

        const proofMsg = await getLatestProofMessage(thread, interaction.user.id, cfg.proof?.maxMinutesSinceProof ?? 5);
        if (!proofMsg) {
          return interaction.editReply(`📸 Anexe um print dos últimos ${(cfg.proof?.maxMinutesSinceProof ?? 5)} min e tente /armazenar.`);
        }

        if (isProofUsed(interaction.guildId, proofMsg.id)) {
          return interaction.editReply('⚠️ Esse print já foi usado. Anexe um print novo e tente novamente.');
        }

        session.set(interaction.user.id, {
          threadId: thread.id,
          proofUrl: proofMsg.url,
          proofMessageId: proofMsg.id,
          itemKey: null,
          qty: null
        });

        return interaction.editReply({
          content: `O que você está registrando?\n✅ Print detectado com sucesso.`,
          components: [itemsMenu()]
        });
      }

      if (cmd === 'meu_total') {
        await interaction.deferReply({ flags: 64 });

        const totals = totalsByUser(interaction.guildId, interaction.user.id, { onlyOpen: false });
        const keys = Object.keys(totals);

        if (!keys.length) return interaction.editReply('Ainda não há registros seus.');

        const lines = keys.map(k => {
          const label = getItem(k)?.label || k;
          return `• **${label}**: ${totals[k]}`;
        });

        return interaction.editReply(`📦 **Seus totais (geral):**\n${lines.join('\n')}`);
      }

      if (cmd === 'total_funcionario') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('usuario', true);
        const totals = totalsByUser(interaction.guildId, user.id, { onlyOpen: false });
        const keys = Object.keys(totals);
        if (!keys.length) return interaction.editReply(`Sem registros para ${user.tag}.`);

        const lines = keys.map(k => {
          const label = getItem(k)?.label || k;
          return `• **${label}**: ${totals[k]}`;
        });

        return interaction.editReply(`📦 **Totais de ${user.tag} (geral):**\n${lines.join('\n')}`);
      }

      if (cmd === 'resumo_dia') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const day = interaction.options.getString('data') || ymd();
        const map = totalsDay(interaction.guildId, day);

        if (!map.size) return interaction.editReply(`Sem registros em **${day}**.`);

        const lines = [];
        for (const [key, totals] of map.entries()) {
          const [, tag] = key.split('|');
          const items = Object.keys(totals).map(k => {
            const label = getItem(k)?.label || k;
            return `${label}: ${totals[k]}`;
          }).join(', ');
          lines.push(`• **${tag}** — ${items}`);
        }

        return interaction.editReply(`📅 **Resumo — ${day}**\n${lines.join('\n')}`);
      }

      if (cmd === 'exportar_csv') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const inicio = interaction.options.getString('inicio', true);
        const fim = interaction.options.getString('fim', true);

        const deposits = validDeposits(loadDeposits())
          .filter(d => d.guildId === interaction.guildId && d.day >= inicio && d.day <= fim);

        const rows = deposits.map(d => ({
          id: d.id,
          day: d.day,
          userId: d.userId,
          userTag: d.userTag,
          itemKey: d.itemKey,
          itemLabel: getItem(d.itemKey)?.label || d.itemKey,
          qty: d.qty,
          status: d.status,
          proofUrl: d.proofUrl,
          createdAt: d.createdAt,
          paymentId: d.paymentId || '',
          paidAt: d.paidAt || '',
          paidBy: d.paidBy || '',
          canceledAt: d.canceledAt || '',
          canceledBy: d.canceledBy || '',
          cancelReason: d.cancelReason || ''
        }));

        const csv = stringify(rows, { header: true });
        const file = new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `export_${inicio}_a_${fim}.csv` });

        return interaction.editReply({ content: `✅ CSV gerado: ${inicio} → ${fim}`, files: [file] });
      }

      if (cmd === 'preco_lista') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const map = getPriceMap();
        const lines = Object.keys(map).sort().map(k => {
          const label = getItem(k)?.label || k;
          return `• **${label}** (${k}): **${money(map[k])}**`;
        });

        return interaction.editReply(`🏷️ **Preços atuais:**\n${lines.join('\n')}`);
      }

      if (cmd === 'preco_set') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const itemKey = interaction.options.getString('item', true);
        const value = interaction.options.getNumber('valor', true);

        if (!getItem(itemKey)) return interaction.editReply('❌ Item inválido (key não existe em cfg.items).');

        setPrice(itemKey, value);
        return interaction.editReply(`✅ Preço atualizado: **${getItem(itemKey).label}** = **${money(value)}**`);
      }

      if (cmd === 'pagamento') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('usuario', true);
        const calc = computePayment(interaction.guildId, user.id);
        const keys = Object.keys(calc.itemTotals);

        if (!keys.length) return interaction.editReply(`✅ ${user.tag} não tem nada em aberto.`);

        const lines = keys.map(k => {
          const label = getItem(k)?.label || k;
          return `• **${label}**: ${calc.itemTotals[k]} → **${money(calc.itemMoney[k])}**`;
        });

        return interaction.editReply(
          `💰 **Em aberto — ${user.tag}**\n` +
          `${lines.join('\n')}\n\n` +
          `Total: **${money(calc.grand)}**`
        );
      }

      if (cmd === 'pagar') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('usuario', true);
        const overrideValue = interaction.options.getNumber('valor', false);

        const deposits = loadDeposits();
        const open = deposits.filter(d =>
          d.guildId === interaction.guildId &&
          d.userId === user.id &&
          d.status === 'ABERTO' &&
          d.status !== 'CANCELADO'
        );

        if (!open.length) return interaction.editReply(`✅ ${user.tag} não tem nada em aberto.`);

        const calc = computePayment(interaction.guildId, user.id);
        const valueToPay = (typeof overrideValue === 'number') ? overrideValue : calc.grand;

        const openDays = open.map(d => d.day).filter(Boolean).sort();
        const periodStart = openDays[0] || ymd();
        const periodEnd = ymd();

        const payId = `pay_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
        for (const d of deposits) {
          if (d.guildId === interaction.guildId && d.userId === user.id && d.status === 'ABERTO') {
            d.status = 'PAGO';
            d.paymentId = payId;
            d.paidAt = nowIso();
            d.paidBy = interaction.user.tag;
          }
        }
        saveDeposits(deposits);

        const payments = loadPayments();
        payments.push({
          guildId: interaction.guildId,
          paymentId: payId,
          userId: user.id,
          userTag: user.tag,
          paidValue: Number(valueToPay),
          calculatedValue: Number(calc.grand),
          periodStart,
          periodEnd,
          paidAt: nowIso(),
          paidBy: interaction.user.tag
        });
        savePayments(payments);

        await sendPaymentLog(interaction,
          `💰 **Pagamento registrado**\n` +
          `• Funcionário: **${user.tag}**\n` +
          `• Período: **${brDateFromYMD(periodStart)}** até **${brDateFromYMD(periodEnd)}**\n` +
          `• Valor calculado: **${money(calc.grand)}**\n` +
          `• Valor registrado: **${money(valueToPay)}**\n` +
          `• Pago por: **${interaction.user.tag}**\n` +
          `• Data: **${periodEnd}**\n` +
          `• paymentId: **${payId}**`
        );

        return interaction.editReply(
          `✅ Pago registrado para **${user.tag}**.\n` +
          `Total: **${money(calc.grand)}** | Registrado: **${money(valueToPay)}**\n` +
          `paymentId: **${payId}**`
        );
      }

      if (cmd === 'ranking') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const periodo = interaction.options.getString('periodo', true);
        const itemKey = interaction.options.getString('item', false);

        const list = computeRanking(interaction.guildId, periodo, itemKey || null);
        if (!list.length) return interaction.editReply('Sem dados no período.');

        const title = itemKey ? (getItem(itemKey)?.label || itemKey) : 'GERAL';
        const lines = list.map((x, i) => `**${i + 1}.** ${x.tag} — **${x.total}**`);

        return interaction.editReply(`🏆 **Ranking (${periodo}) — ${title}**\n${lines.join('\n')}`);
      }

      if (cmd === 'cancelar_registro') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const id = interaction.options.getInteger('id', true);
        const motivo = interaction.options.getString('motivo', true);

        const deposits = loadDeposits();
        const target = deposits.find(d => d.guildId === interaction.guildId && d.id === id);

        if (!target) return interaction.editReply('❌ Registro não encontrado.');
        if (target.status === 'CANCELADO') return interaction.editReply('⚠️ Esse registro já está cancelado.');

        target.status = 'CANCELADO';
        target.canceledAt = nowIso();
        target.canceledBy = interaction.user.tag;
        target.cancelReason = motivo;

        saveDeposits(deposits);

        await sendDepositLog(interaction,
          `🗑️ **Registro cancelado**\n` +
          `• ID: **${id}**\n` +
          `• Funcionário: **${target.userTag}**\n` +
          `• Item: **${getItem(target.itemKey)?.label || target.itemKey}**\n` +
          `• Quantidade: **${target.qty}**\n` +
          `• Cancelado por: **${interaction.user.tag}**\n` +
          `• Motivo: **${motivo}**\n` +
          `• Prova: ${target.proofUrl}`
        );

        return interaction.editReply(`✅ Registro **${id}** cancelado.`);
      }

      // =====================
      // NOVO: /listar_registros (STAFF)
      // =====================
      if (cmd === 'listar_registros') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const user = interaction.options.getUser('usuario', false);
        const status = interaction.options.getString('status', false) || 'TODOS';
        const limite = Math.min(Math.max(interaction.options.getInteger('limite', false) || 20, 1), 50);

        let deposits = loadDeposits().filter(d => d.guildId === interaction.guildId);

        if (user) deposits = deposits.filter(d => d.userId === user.id);
        if (status !== 'TODOS') deposits = deposits.filter(d => d.status === status);

        // mais recentes primeiro
        deposits.sort((a, b) => {
          const ta = new Date(a.createdAt || a.day || 0).getTime();
          const tb = new Date(b.createdAt || b.day || 0).getTime();
          return tb - ta;
        });

        const slice = deposits.slice(0, limite);
        if (!slice.length) {
          const who = user ? ` para **${user.tag}**` : '';
          const st = status !== 'TODOS' ? ` (status **${status}**)` : '';
          return interaction.editReply(`Sem registros${who}${st}.`);
        }

        const lines = slice.map(d => {
          const label = getItem(d.itemKey)?.label || d.itemKey;
          const dt = d.day ? brDateFromYMD(d.day) : '—';
          return `• **#${d.id}** | **${dt}** | **${d.userTag}** | **${label}** x **${d.qty}** | **${d.status}**`;
        });

        const header =
          `📄 **Registros (${slice.length}/${deposits.length})**\n` +
          `${user ? `👤 Usuário: **${user.tag}**\n` : ''}` +
          `${status !== 'TODOS' ? `🏷️ Status: **${status}**\n` : ''}`;

        // Discord tem limite de caracteres; quebra em blocos se precisar
        const out = `${header}\n${lines.join('\n')}`;
        if (out.length <= 1900) return interaction.editReply(out);

        // fallback: manda só os IDs se estourar
        const ids = slice.map(d => d.id).join(', ');
        return interaction.editReply(
          `${header}\n` +
          `⚠️ Lista muito grande para exibir completa.\n` +
          `IDs (top ${slice.length}): ${ids}`
        );
      }

      // =====================
      // NOVO: /cancelar_lote (STAFF)
      // =====================
      if (cmd === 'cancelar_lote') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const idsRaw = interaction.options.getString('ids', true);
        const motivo = interaction.options.getString('motivo', true);

        const ids = idsRaw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(n => Number(n))
          .filter(n => Number.isInteger(n) && n > 0);

        if (!ids.length) return interaction.editReply('❌ Informe IDs válidos. Ex: `10,11,12`');

        const deposits = loadDeposits();
        const guildDeposits = deposits.filter(d => d.guildId === interaction.guildId);

        const found = [];
        const notFound = [];
        const alreadyCanceled = [];

        for (const id of ids) {
          const target = guildDeposits.find(d => d.id === id);
          if (!target) { notFound.push(id); continue; }
          if (target.status === 'CANCELADO') { alreadyCanceled.push(id); continue; }

          target.status = 'CANCELADO';
          target.canceledAt = nowIso();
          target.canceledBy = interaction.user.tag;
          target.cancelReason = motivo;
          found.push(id);
        }

        saveDeposits(deposits);

        if (found.length) {
          await sendDepositLog(interaction,
            `🧾 **Cancelamento em lote**\n` +
            `• IDs: **${found.join(', ')}**\n` +
            `• Cancelado por: **${interaction.user.tag}**\n` +
            `• Motivo: **${motivo}**`
          );
        }

        const parts = [];
        if (found.length) parts.push(`✅ Cancelados: **${found.join(', ')}**`);
        if (alreadyCanceled.length) parts.push(`⚠️ Já estavam cancelados: **${alreadyCanceled.join(', ')}**`);
        if (notFound.length) parts.push(`❌ Não encontrados: **${notFound.join(', ')}**`);

        return interaction.editReply(parts.join('\n'));
      }

      // =====================
      // NOVO: /apagar_pasta (STAFF)
      // - se usado dentro de uma thread privada: apaga a própria thread
      // - se informar /apagar_pasta usuario: tenta localizar thread por nome e apaga
      // =====================
      if (cmd === 'apagar_pasta') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const targetUser = interaction.options.getUser('usuario', false);

        // 1) Se está dentro de thread privada, e NÃO passou usuário: apaga a thread atual
        const ch = interaction.channel;
        if (!targetUser) {
          const isThread = ch && (ch.type === ChannelType.PrivateThread || ch.type === ChannelType.PublicThread);
          if (!isThread) {
            return interaction.editReply('⚠️ Use dentro da pasta (thread) OU informe um usuário: **/apagar_pasta usuario:@fulano**');
          }

          // Apaga a thread atual
          await ch.delete(`Apagar pasta (staff) por ${interaction.user.tag}`).catch(() => null);
          return interaction.editReply('✅ Pasta apagada (thread removida).');
        }

        // 2) Com usuário: tenta localizar
        const thread = await findFarmThreadByUser(interaction.guild, targetUser);
        if (!thread) {
          return interaction.editReply(`❌ Não encontrei a pasta de **${targetUser.tag}**.`);
        }

        await thread.delete(`Apagar pasta (staff) por ${interaction.user.tag}`).catch(() => null);
        return interaction.editReply(`✅ Pasta de **${targetUser.tag}** apagada.`);
      }
    }

    // =====================
    // SELECT MENU (item)
    // =====================
    if (interaction.isStringSelectMenu() && interaction.customId === 'armazenar_select_item') {
      const s = session.get(interaction.user.id);
      if (!s) return interaction.reply({ content: '⚠️ Sessão expirou. Use /armazenar de novo.', flags: 64 });
      if (interaction.channelId !== s.threadId) return interaction.reply({ content: '⚠️ Use dentro da sua pasta.', flags: 64 });

      const itemKey = interaction.values[0];
      if (!getItem(itemKey)) return interaction.reply({ content: '❌ Item inválido.', flags: 64 });

      s.itemKey = itemKey;
      session.set(interaction.user.id, s);

      return interaction.showModal(qtyModal(itemKey));
    }

    // =====================
    // MODAL (qty)
    // =====================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('armazenar_qty_modal:')) {
      await interaction.deferReply({ flags: 64 });

      const itemKey = interaction.customId.split(':')[1];
      const qtyRaw = interaction.fields.getTextInputValue('qty').trim();
      const qty = Number(qtyRaw);

      if (!Number.isInteger(qty) || qty <= 0 || qty > 1000000) {
        return interaction.editReply('❌ Quantidade inválida. Use um número inteiro maior que 0.');
      }

      const s = session.get(interaction.user.id);
      if (!s) return interaction.editReply('⚠️ Sessão expirou. Use /armazenar de novo.');
      if (interaction.channelId !== s.threadId) return interaction.editReply('⚠️ Use dentro da sua pasta.');

      s.qty = qty;
      session.set(interaction.user.id, s);

      const label = getItem(itemKey)?.label || itemKey;

      return interaction.editReply({
        content:
          `Confira os dados do registro:\n\n` +
          `• Item: **${label}**\n` +
          `• Quantidade: **${qty}**\n\n` +
          `Deseja confirmar?`,
        components: [confirmButtons()]
      });
    }

    // =====================
    // BUTTONS (confirm/cancel)
    // =====================
    if (interaction.isButton()) {
      if (interaction.customId === 'armazenar_cancelar') {
        session.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Registro cancelado.', flags: 64 });
      }

      if (interaction.customId === 'armazenar_confirmar') {
        await interaction.deferReply({ flags: 64 });

        const s = session.get(interaction.user.id);
        if (!s) return interaction.editReply('⚠️ Sessão expirou. Use /armazenar de novo.');
        if (interaction.channelId !== s.threadId) return interaction.editReply('⚠️ Use dentro da sua pasta.');

        if (isProofUsed(interaction.guildId, s.proofMessageId)) {
          session.delete(interaction.user.id);
          return interaction.editReply('⚠️ Esse print já foi usado. Poste um novo print e tente /armazenar.');
        }

        const deposits = loadDeposits();
        const nextId = (deposits.reduce((m, d) => Math.max(m, d.id || 0), 0) || 0) + 1;

        const rec = {
          id: nextId,
          guildId: interaction.guildId,
          day: ymd(),
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          itemKey: s.itemKey,
          qty: s.qty,
          proofUrl: s.proofUrl,
          proofMessageId: s.proofMessageId,
          status: 'ABERTO',
          createdAt: nowIso()
        };

        deposits.push(rec);
        saveDeposits(deposits);
        session.delete(interaction.user.id);

        await sendDepositLog(interaction,
          `📦 **Novo registro**\n` +
          `• ID: **${rec.id}**\n` +
          `• Funcionário: **${rec.userTag}**\n` +
          `• Item: **${getItem(rec.itemKey)?.label || rec.itemKey}**\n` +
          `• Quantidade: **${rec.qty}**\n` +
          `• Data: **${rec.day}**\n` +
          `• Prova: ${rec.proofUrl}`
        );

        return interaction.editReply(`✅ Registro salvo! ID **${rec.id}**`);
      }
    }
  } catch (e) {
    console.error(e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ Ocorreu um erro. Veja o console do bot.');
      } else {
        await interaction.reply({ content: '❌ Ocorreu um erro. Veja o console do bot.', flags: 64 });
      }
    } catch {}
  }
});

client.login(process.env.TOKEN || cfg.token);



// =====================
// DETECTAR PRINT E MOSTRAR BOTÃO
// =====================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.channel.isThread()) return;
    if (!message.attachments || message.attachments.size === 0) return;

    const recent = await message.channel.messages.fetch({ limit: 5 }).catch(() => null);
    const alreadyHasButton = recent?.some?.(m =>
      m.author?.id === client.user.id &&
      m.components?.some?.(row => row.components?.some?.(c => c.customId === 'register_farm'))
    );

    if (alreadyHasButton) return;

    await message.channel.send({
      content: `📦 Print recebido com sucesso.\n\nClique em "Registrar Farm" para continuar.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('register_farm')
            .setLabel('Registrar Farm')
            .setStyle(ButtonStyle.Success)
        )
      ]
    });
  } catch (err) {
    console.error('Erro ao detectar print:', err);
  }
});
