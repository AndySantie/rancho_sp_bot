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
const path = require('path');
const fs = require('fs');

// ✅ Carrega config.local.json se existir; senão usa config.json
const cfgPath = fs.existsSync(path.join(__dirname, 'config.local.json'))
  ? './config.local.json'
  : './config.json';

const cfg = require(cfgPath);

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

// =====================
// DATA ACCESS
// =====================
function loadDeposits() { return readJson(depositsFile, []); }
function saveDeposits(d) { writeJson(depositsFile, d); }

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
    `👋 **Pasta privada criada!**\n` +
    `Use /armazenar aqui dentro.\n` +
    `📸 Sempre anexe um print antes de registrar.\n\n` +
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

async function upsertPanelMessage({ key, channelId, content, components }) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const panels = loadPanels();
  const old = panels[key];

  let msg = null;
  if (old?.messageId) {
    msg = await channel.messages.fetch(old.messageId).catch(() => null);
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
      .setCustomId('register_open_modal')
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

  const text =
    '📌 **COMO REGISTRAR FARM (PASSO A PASSO)**\n' +
    '1) Use **/minha_pasta** para abrir sua pasta privada\n' +
    '2) Dentro da sua pasta, **anexe um PRINT** do inventário/baú (obrigatório)\n' +
    '3) Depois do print, use **/armazenar** e selecione o item + quantidade\n' +
    '4) Pronto: o registro vai para o **log-farm** e entra no seu total\n\n' +
    '⚠️ **Regras rápidas**\n' +
    `• Print vale **${mins} minutos**\n` +
    '• Print **não pode** ser reutilizado\n' +
    '• Se errar, chame a gerência';

  await upsertPanelMessage({
    key: 'farm_guide',
    channelId,
    content: text,
    components: []
  });
}

async function ensureCommandsPanel() {
  const channelId = cfg.channels?.commandsChannelId;
  if (!channelId) return;

  // Atualizado com “quebra de linha” + novos comandos staff
  const text =
    '📌 **COMANDOS DO BOT — FARM**\n\n' +
    '✅ **Funcionários**\n' +
    '• **/minha_pasta** → cria/abre sua pasta privada de FARM\n' +
    '• **/armazenar** → registra um armazenamento (print obrigatório antes)\n' +
    '• **/meu_total** → mostra seus totais\n\n' +
    '👑 **Somente Gerência/Proprietário**\n' +
    '• **/total_funcionario** → totais de um funcionário\n' +
    '• **/resumo_dia** → resumo do dia\n' +
    '• **/exportar_csv** → exporta CSV por período\n' +
    '• **/pagamento** → calcula o que está em aberto\n' +
    '• **/pagar** → fecha período como PAGO e gera recibo\n' +
    '• **/ranking** → ranking por período (e por item opcional)\n' +
    '• **/preco_lista** → lista preços\n' +
    '• **/preco_set** → altera preço\n' +
    '• **/cancelar_registro** → cancela um registro por ID\n' +
    '• **/cancelar_lote** → cancela vários registros por IDs (ex: 10,11,12)\n' +
    '• **/listar_registros** → lista registros (filtro por usuário/status)\n' +
    '• **/apagar_pasta** → apaga a pasta (thread) de farm de um funcionário';

  await upsertPanelMessage({
    key: 'commands',
    channelId,
    content: text,
    components: []
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

  const embed = new EmbedBuilder()
    .setTitle('🐴 Bem-vindo(a) ao HARAS RANCHO SP')
    .setDescription(
      `Seja bem-vindo(a), ${member}!\n\n` +
      `📌 **Primeiro passo**\n` +
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
  await ensureCommandsPanel();
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

// =====================
// MAIN
// =====================
const session = new Map();

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // =====================
    // REGISTRO (botão + modal)
    // =====================
    if (interaction.isButton() && interaction.customId === 'register_open_modal') {
      return interaction.showModal(registerModal());
    }

    if (interaction.isModalSubmit() && interaction.customId === 'register_modal_submit') {
      await interaction.deferReply({ ephemeral: true });

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
        return interaction.editReply('❌ Não consegui dar o cargo. Verifique se o cargo do bot está acima do cargo Funcionário e se ele tem Manage Roles.');
      }

      const nick = safeNick(`${interaction.user.username} (vulgo ${rp} - ${bag})`);
      try {
        await member.setNickname(nick, 'Registro automático (bot)');
      } catch (e) {
        console.error(e);
        return interaction.editReply(
          '✅ Cargo **Funcionário** aplicado.\n' +
          '⚠️ Não consegui alterar o nickname. Verifique se o bot tem Manage Nicknames e está acima do cargo do membro.'
        );
      }

      return interaction.editReply(`✅ Registrado com sucesso!\n• Cargo: **Funcionário**\n• Nick: **${nick}**`);
    }

    // =====================
    // SLASH COMMANDS
    // =====================
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

if (cmd === 'anunciar') {
  // Apenas Gerência/Proprietário
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const canal = interaction.options.getChannel('canal', true);
  const mensagem = interaction.options.getString('mensagem', true);
  const imagem = interaction.options.getAttachment('imagem', false);
  const fixar = interaction.options.getBoolean('fixar', false) ?? false;

  const mencionar = interaction.options.getMentionable('mencionar', false);
  const allowEveryone = interaction.options.getBoolean('everyone', false) ?? false;
  const allowHere = interaction.options.getBoolean('here', false) ?? false;

  // Canal precisa ser de texto (GuildText ou Announcement). Thread também é text-based, mas aqui preferimos canal normal.
  if (!canal || !canal.isTextBased?.() || canal.type === ChannelType.DM) {
    return interaction.editReply('❌ Selecione um canal de texto válido.');
  }

  const targetChannel = canal;

  // Monta menções com segurança (allowedMentions)
  let contentMentions = '';
  const allowedMentions = { parse: [], roles: [], users: [] };

  if (mencionar) {
    // mentionable pode ser Role, User ou GuildMember
    if (mencionar.id && mencionar.name !== undefined && mencionar.members !== undefined) {
      // Role
      contentMentions += `<@&${mencionar.id}> `;
      allowedMentions.roles = [mencionar.id];
    } else {
      // User ou GuildMember
      const uid = mencionar.user?.id || mencionar.id;
      if (uid) {
        contentMentions += `<@${uid}> `;
        allowedMentions.users = [uid];
      }
    }
  }

  // @everyone e @here são controlados pelo parse 'everyone'
  if (allowEveryone) contentMentions += '@everyone ';
  if (allowHere) contentMentions += '@here ';
  if (allowEveryone || allowHere) allowedMentions.parse = ['everyone'];

  // Embed padrão Rancho SP
  const embed = new EmbedBuilder()
    .setTitle('📣 Anúncio — Rancho SP')
    .setDescription(mensagem)
    .setFooter({ text: 'Rancho SP • Haras Management' })
    .setTimestamp(new Date());

  // Logo (thumbnail)
  const logoPath = path.join(__dirname, 'assets', 'ranchosp.png');
  const files = [];
  if (fs.existsSync(logoPath)) {
    embed.setThumbnail('attachment://ranchosp.png');
    files.push(new AttachmentBuilder(logoPath));
  }

  // Imagem do anúncio (upload)
  if (imagem?.url) {
    embed.setImage(imagem.url);
  }

  // Envia no canal escolhido
  let sentMsg = null;
  try {
    sentMsg = await targetChannel.send({
      content: contentMentions.trim() || undefined,
      embeds: [embed],
      files,
      allowedMentions
    });
  } catch (e) {
    console.error('Erro ao enviar anúncio:', e);
    return interaction.editReply('❌ Não consegui enviar o anúncio. Verifique permissões do bot nesse canal (Enviar mensagens / Incorporar links / Anexar arquivos).');
  }

  // Fixar se solicitado
  if (fixar && sentMsg) {
    try {
      await sentMsg.pin();
    } catch (e) {
      // Não falha o comando por isso
      console.error('Erro ao fixar anúncio:', e);
      return interaction.editReply('✅ Anúncio enviado, mas não consegui fixar (falta permissão de Gerenciar Mensagens).');
    }
  }

  return interaction.editReply(`✅ Anúncio enviado em ${targetChannel.toString()}${fixar ? ' e fixado.' : '.'}`);
}


      if (cmd === 'minha_pasta') {
        await interaction.deferReply({ ephemeral: true });
        const thread = await getOrCreatePrivateThread(interaction);
        return interaction.editReply(`✅ Sua pasta: ${thread.toString()}`);
      }

      if (cmd === 'armazenar') {
        await interaction.deferReply({ ephemeral: true });

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
          content: `O que você está armazenando?\n✅ Print detectado (último): ${proofMsg.url}`,
          components: [itemsMenu()]
        });
      }

      if (cmd === 'meu_total') {
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        const map = getPriceMap();
        const lines = Object.keys(map).sort().map(k => {
          const label = getItem(k)?.label || k;
          return `• **${label}** (${k}): **${money(map[k])}**`;
        });

        return interaction.editReply(`🏷️ **Preços atuais:**\n${lines.join('\n')}`);
      }

      if (cmd === 'preco_set') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        const itemKey = interaction.options.getString('item', true);
        const value = interaction.options.getNumber('valor', true);

        if (!getItem(itemKey)) return interaction.editReply('❌ Item inválido (key não existe em cfg.items).');

        setPrice(itemKey, value);
        return interaction.editReply(`✅ Preço atualizado: **${getItem(itemKey).label}** = **${money(value)}**`);
      }

      if (cmd === 'pagamento') {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
          return interaction.reply({ content: '❌ Apenas Gerência/Proprietário.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
      if (!s) return interaction.reply({ content: '⚠️ Sessão expirou. Use /armazenar de novo.', ephemeral: true });
      if (interaction.channelId !== s.threadId) return interaction.reply({ content: '⚠️ Use dentro da sua pasta.', ephemeral: true });

      const itemKey = interaction.values[0];
      if (!getItem(itemKey)) return interaction.reply({ content: '❌ Item inválido.', ephemeral: true });

      s.itemKey = itemKey;
      session.set(interaction.user.id, s);

      return interaction.showModal(qtyModal(itemKey));
    }

    // =====================
    // MODAL (qty)
    // =====================
    if (interaction.isModalSubmit() && interaction.customId.startsWith('armazenar_qty_modal:')) {
      await interaction.deferReply({ ephemeral: true });

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
          `Confirme o registro:\n` +
          `• Item: **${label}**\n` +
          `• Quantidade: **${qty}**\n` +
          `• Print: ${s.proofUrl}\n\n` +
          `✅ Confirmar ou ❌ Cancelar?`,
        components: [confirmButtons()]
      });
    }

    // =====================
    // BUTTONS (confirm/cancel)
    // =====================
    if (interaction.isButton()) {
      if (interaction.customId === 'armazenar_cancelar') {
        session.delete(interaction.user.id);
        return interaction.reply({ content: '❌ Registro cancelado.', ephemeral: true });
      }

      if (interaction.customId === 'armazenar_confirmar') {
        await interaction.deferReply({ ephemeral: true });

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
        await interaction.reply({ content: '❌ Ocorreu um erro. Veja o console do bot.', ephemeral: true });
      }
    } catch {}
  }
});

client.login(process.env.TOKEN || cfg.token);
