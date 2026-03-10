const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const horses = require('./horses.json');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function moneyBr(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatHorseSummary(horse) {
  return `Total ${horse.total} • ${horse.clima} • ${horse.valorTexto}`;
}

function sortByName(list) {
  return [...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function topHorsesByTotal(limit = 10) {
  return [...horses]
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    })
    .slice(0, limit);
}

function horsesByClimate(clima) {
  return horses
    .filter((horse) => normalizeText(horse.clima) === normalizeText(clima))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

function rankingByField(field) {
  return [...horses].sort((a, b) => {
    const diff = safeNumber(b[field]) - safeNumber(a[field]);
    if (diff !== 0) return diff;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

function attributeMeta(field) {
  const map = {
    total: { label: 'Total', emoji: '🏆' },
    velocidade: { label: 'Velocidade', emoji: '💨' },
    aceleracao: { label: 'Aceleração', emoji: '🔥' },
    vida: { label: 'Vida', emoji: '❤️' },
    estamina: { label: 'Estamina', emoji: '⚡' },
    coragem: { label: 'Coragem', emoji: '🛡️' },
    agilidade: { label: 'Agilidade', emoji: '🪶' },
  };
  return map[field] || { label: field, emoji: '📊' };
}

function padRight(text, size) {
  return String(text).padEnd(size, ' ');
}

function buildColorBar(value, max, fillEmoji) {
  const safeValue = Math.max(0, Math.min(safeNumber(value), max));
  const filled = Math.round(safeValue);
  const empty = Math.max(0, max - filled);
  return `${fillEmoji.repeat(filled)}${'⬜'.repeat(empty)} ${safeValue}/${max}`;
}

function buildStarsFromTotal(total) {
  const safeTotal = Math.max(0, Math.min(safeNumber(total), 60));
  let stars = 1;

  if (safeTotal >= 49) {
    stars = 5;
  } else if (safeTotal >= 37) {
    stars = 4;
  } else if (safeTotal >= 25) {
    stars = 3;
  } else if (safeTotal >= 13) {
    stars = 2;
  }

  return '⭐'.repeat(stars);
}

function statLine(label, value, max, emoji) {
  return `${padRight(label, 12)} ${buildColorBar(value, max, emoji)}`;
}

function totalLine(total) {
  const safeTotal = Math.max(0, Math.min(safeNumber(total), 60));
  const stars = buildStarsFromTotal(safeTotal);
  return `${padRight('Total', 12)} ${safeTotal}/60 ${stars}`;
}

function buildHorseStatsBlock(horse) {
  return [
    statLine('Vida', horse.vida, 10, '🟥'),
    statLine('Estamina', horse.estamina, 10, '🟩'),
    statLine('Coragem', horse.coragem, 10, '🟫'),
    statLine('Agilidade', horse.agilidade, 10, '🟪'),
    statLine('Velocidade', horse.velocidade, 10, '🟦'),
    statLine('Aceleracao', horse.aceleracao, 10, '🟨'),
    totalLine(horse.total),
  ].join('\n');
}

function buildCompareTotalLine(label, totalA, totalB, horseAName, horseBName) {
  const safeA = Math.max(0, Math.min(safeNumber(totalA), 60));
  const safeB = Math.max(0, Math.min(safeNumber(totalB), 60));
  let winner = 'Empate';

  if (safeA > safeB) winner = horseAName;
  if (safeB > safeA) winner = horseBName;

  return [
    `**${label}**`,
    `${horseAName}: ${safeA}/60 ${buildStarsFromTotal(safeA)}`,
    `${horseBName}: ${safeB}/60 ${buildStarsFromTotal(safeB)}`,
    `Vantagem: **${winner}**`,
  ].join('\n');
}

function buildCompareStatsBlock(horseA, horseB) {
  const lines = [
    {
      label: 'Vida',
      a: safeNumber(horseA.vida),
      b: safeNumber(horseB.vida),
      max: 10,
      emoji: '🟥',
    },
    {
      label: 'Estamina',
      a: safeNumber(horseA.estamina),
      b: safeNumber(horseB.estamina),
      max: 10,
      emoji: '🟩',
    },
    {
      label: 'Coragem',
      a: safeNumber(horseA.coragem),
      b: safeNumber(horseB.coragem),
      max: 10,
      emoji: '🟫',
    },
    {
      label: 'Agilidade',
      a: safeNumber(horseA.agilidade),
      b: safeNumber(horseB.agilidade),
      max: 10,
      emoji: '🟪',
    },
    {
      label: 'Velocidade',
      a: safeNumber(horseA.velocidade),
      b: safeNumber(horseB.velocidade),
      max: 10,
      emoji: '🟦',
    },
    {
      label: 'Aceleracao',
      a: safeNumber(horseA.aceleracao),
      b: safeNumber(horseB.aceleracao),
      max: 10,
      emoji: '🟨',
    },
  ];

  const blocks = lines.map((row) => {
    let winner = 'Empate';
    if (row.a > row.b) winner = horseA.nome;
    if (row.b > row.a) winner = horseB.nome;

    return [
      `**${row.label}**`,
      `${horseA.nome}: ${buildColorBar(row.a, row.max, row.emoji)}`,
      `${horseB.nome}: ${buildColorBar(row.b, row.max, row.emoji)}`,
      `Vantagem: **${winner}**`,
    ].join('\n');
  });

  blocks.push(
    buildCompareTotalLine('Total', horseA.total, horseB.total, horseA.nome, horseB.nome),
  );

  return blocks.join('\n\n');
}

function buildHorseEmbed(horse) {
  const statsBlock = buildHorseStatsBlock(horse);

  return new EmbedBuilder()
    .setTitle(`🐎 ${horse.nome}`)
    .setDescription(`Consulta completa do cavalo selecionado.\n\n\`\`\`\n${statsBlock}\n\`\`\``)
    .addFields(
      { name: '🌦️ Clima', value: String(horse.clima || '-'), inline: true },
      { name: '⚖️ Peso', value: String(horse.peso || '-'), inline: true },
      { name: '💰 Valor', value: horse.valorTexto || moneyBr(horse.valorNumero), inline: true },
    )
    .setFooter({ text: `ID interno: ${horse.id}` });
}

function buildHorseSelectPage(page = 0, filtered = sortByName(horses), customId = null, title = '🐎 Consultar cavalo', description = null) {
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selectCustomId = customId || `horses:select:${safePage}`;

  const select = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder(`Escolha um cavalo (${filtered.length} encontrados)`)
    .addOptions(
      slice.map((horse) => ({
        label: horse.nome.slice(0, 100),
        value: horse.id,
        description: formatHorseSummary(horse).slice(0, 100),
      })),
    );

  const rows = [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`horses:page:${Math.max(0, safePage - 1)}`)
        .setLabel('⬅️ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`horses:page:${Math.min(totalPages - 1, safePage + 1)}`)
        .setLabel('Próxima ➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('horses:search')
        .setLabel('🔎 Pesquisar')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:panel')
        .setLabel('🏠 Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      description ||
        `Página **${safePage + 1}/${totalPages}** • Escolha um cavalo na lista abaixo.`,
    );

  return { embed, rows };
}

function buildMainPanel() {
  const quentes = horsesByClimate('Quente').length;
  const frios = horsesByClimate('Frio').length;
  const mistos = horsesByClimate('Misto').length;

  const embed = new EmbedBuilder()
    .setTitle('🐎 HARAS RANCHO SP • PAINEL DE CAVALOS')
    .setDescription('Consulta rápida dos cavalos cadastrados.')
    .addFields(
      { name: '📚 Total de cavalos', value: String(horses.length), inline: true },
      { name: '🔥 Clima quente', value: String(quentes), inline: true },
      { name: '❄️ Clima frio', value: String(frios), inline: true },
      { name: '🌤️ Clima misto', value: String(mistos), inline: true },
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:list')
        .setLabel('📋 Consultar cavalos')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:search')
        .setLabel('🔎 Pesquisar cavalo')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('horses:compare')
        .setLabel('⚔️ Comparar cavalos')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:rankingMenu')
        .setLabel('🏆 Ranking')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:climate')
        .setLabel('🌦️ Ver por clima')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:ranking')
        .setLabel('📊 Top 15 total')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, rows };
}

function buildClimateMenu() {
  const embed = new EmbedBuilder()
    .setTitle('🌦️ Cavalos por clima')
    .setDescription('Escolha uma categoria para ver a lista ordenada.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('horses:climate:quente')
      .setLabel('🔥 Quente')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('horses:climate:frio')
      .setLabel('❄️ Frio')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('horses:climate:misto')
      .setLabel('🌤️ Misto')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('horses:panel')
      .setLabel('🏠 Voltar')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, rows: [row] };
}

function chunkLines(lines, chunkSize = 10) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildSimpleListEmbed(title, items) {
  const lines = items.map((horse, index) => {
    return `**${index + 1}. ${horse.nome}** — Total ${horse.total} • ${horse.clima} • ${horse.valorTexto}`;
  });

  const chunks = chunkLines(lines, 10);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(chunks[0] || 'Nenhum cavalo encontrado.');

  for (let i = 1; i < chunks.length; i++) {
    embed.addFields({ name: '\u200b', value: chunks[i].join('\n') });
  }

  return embed;
}

function buildRankingMenu() {
  const embed = new EmbedBuilder()
    .setTitle('🏆 Ranking de cavalos')
    .setDescription('Escolha o tipo de ranking que deseja consultar.');

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:rankingType:total')
        .setLabel('🏆 Total geral')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:rankingType:velocidade')
        .setLabel('💨 Velocidade')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:rankingType:aceleracao')
        .setLabel('🔥 Aceleração')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:rankingType:vida')
        .setLabel('❤️ Vida')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:rankingType:estamina')
        .setLabel('⚡ Estamina')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:rankingType:coragem')
        .setLabel('🛡️ Coragem')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:rankingType:agilidade')
        .setLabel('🪶 Agilidade')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:panel')
        .setLabel('🏠 Voltar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, rows };
}

function buildRankingPage(field = 'total', page = 0) {
  const meta = attributeMeta(field);
  const ranked = rankingByField(field);
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const slice = ranked.slice(start, start + pageSize);

  const lines = slice.map((horse, index) => {
    const position = start + index + 1;
    if (field === 'total') {
      return `**${position}º. ${horse.nome}** — Total: ${horse.total}/60 ${buildStarsFromTotal(horse.total)}`;
    }
    return `**${position}º. ${horse.nome}** — ${meta.label}: ${horse[field]} • Total ${horse.total}/60 ${buildStarsFromTotal(horse.total)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} Ranking • ${meta.label}`)
    .setDescription(
      `Página **${safePage + 1}/${totalPages}**\n\n${lines.join('\n') || 'Nenhum cavalo encontrado.'}`,
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`horses:rankingPage:${field}:${Math.max(0, safePage - 1)}`)
        .setLabel('⬅️ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`horses:rankingPage:${field}:${Math.min(totalPages - 1, safePage + 1)}`)
        .setLabel('Próxima ➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('horses:rankingMenu')
        .setLabel('🏆 Tipos')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:panel')
        .setLabel('🏠 Painel')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, rows };
}

function buildCompareEmbed(horseA, horseB) {
  const statsBlock = buildCompareStatsBlock(horseA, horseB);

  return new EmbedBuilder()
    .setTitle('⚔️ Comparação de cavalos')
    .setDescription(`**${horseA.nome}** vs **${horseB.nome}**\n\n${statsBlock}`)
    .addFields(
      {
        name: '🌦️ Clima',
        value: `${horseA.nome}: ${horseA.clima}\n${horseB.nome}: ${horseB.clima}`,
        inline: true,
      },
      {
        name: '⚖️ Peso',
        value: `${horseA.nome}: ${horseA.peso}\n${horseB.nome}: ${horseB.peso}`,
        inline: true,
      },
      {
        name: '💰 Valor',
        value: `${horseA.nome}: ${horseA.valorTexto}\n${horseB.nome}: ${horseB.valorTexto}`,
        inline: true,
      },
    );
}

function findHorseById(id) {
  return horses.find((horse) => horse.id === id);
}

function searchHorses(term) {
  const t = normalizeText(term);
  if (!t) return [];
  return sortByName(
    horses.filter((horse) => {
      return (
        normalizeText(horse.nome).includes(t) ||
        normalizeText(horse.clima).includes(t) ||
        normalizeText(horse.valorTexto).includes(t)
      );
    }),
  );
}

function findHorseByNameLoose(name) {
  const term = normalizeText(name);
  if (!term) return null;

  const exact = horses.find((horse) => normalizeText(horse.nome) === term);
  if (exact) return exact;

  const contains = sortByName(horses).find((horse) => normalizeText(horse.nome).includes(term));
  return contains || null;
}

async function sendHorsePanel(interaction) {
  const { embed, rows } = buildMainPanel();
  return interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
}

async function handleHorseInteraction(interaction) {
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'horses:panel') {
      const { embed, rows } = buildMainPanel();
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id === 'horses:list') {
      const { embed, rows } = buildHorseSelectPage(0);
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id.startsWith('horses:page:')) {
      const page = Number(id.split(':')[2] || 0);
      const { embed, rows } = buildHorseSelectPage(page);
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id === 'horses:search') {
      const modal = new ModalBuilder()
        .setCustomId('horses:searchModal')
        .setTitle('Pesquisar cavalo');

      const input = new TextInputBuilder()
        .setCustomId('query')
        .setLabel('Digite o nome do cavalo')
        .setPlaceholder('Ex.: Turkoman, Arabian, Mustang...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (id === 'horses:compare') {
      const modal = new ModalBuilder()
        .setCustomId('horses:compareModal')
        .setTitle('Comparar cavalos');

      const horseA = new TextInputBuilder()
        .setCustomId('horseA')
        .setLabel('Primeiro cavalo')
        .setPlaceholder('Ex.: Arabian')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      const horseB = new TextInputBuilder()
        .setCustomId('horseB')
        .setLabel('Segundo cavalo')
        .setPlaceholder('Ex.: Turkoman')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      modal.addComponents(
        new ActionRowBuilder().addComponents(horseA),
        new ActionRowBuilder().addComponents(horseB),
      );
      return interaction.showModal(modal);
    }

    if (id === 'horses:ranking') {
      const embed = buildSimpleListEmbed('🏆 Top 15 cavalos por total', topHorsesByTotal(15));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('horses:rankingMenu')
          .setLabel('🏆 Ranking completo')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('horses:panel')
          .setLabel('🏠 Voltar')
          .setStyle(ButtonStyle.Secondary),
      );

      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (id === 'horses:rankingMenu') {
      const { embed, rows } = buildRankingMenu();
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id.startsWith('horses:rankingType:')) {
      const field = id.split(':')[2];
      const { embed, rows } = buildRankingPage(field, 0);
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id.startsWith('horses:rankingPage:')) {
      const [, , field, pageRaw] = id.split(':');
      const page = Number(pageRaw || 0);
      const { embed, rows } = buildRankingPage(field, page);
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id === 'horses:climate') {
      const { embed, rows } = buildClimateMenu();
      return interaction.update({ embeds: [embed], components: rows });
    }

    if (id.startsWith('horses:climate:')) {
      const climate = id.split(':')[2];
      const map = {
        quente: 'Quente',
        frio: 'Frio',
        misto: 'Misto',
      };
      const list = horsesByClimate(map[climate] || climate);
      const embed = buildSimpleListEmbed(`🌦️ Cavalos • ${map[climate] || climate}`, list);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('horses:panel')
          .setLabel('🏠 Voltar')
          .setStyle(ButtonStyle.Secondary),
      );

      return interaction.update({ embeds: [embed], components: [row] });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('horses:select:')) {
    const horseId = interaction.values[0];
    const horse = findHorseById(horseId);

    if (!horse) {
      return interaction.reply({
        content: 'Não encontrei esse cavalo na base.',
        ephemeral: true,
      });
    }

    const embed = buildHorseEmbed(horse);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:list')
        .setLabel('📋 Voltar para lista')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:search')
        .setLabel('🔎 Pesquisar')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:compare')
        .setLabel('⚔️ Comparar')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:panel')
        .setLabel('🏠 Painel')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'horses:searchModal') {
    const query = interaction.fields.getTextInputValue('query');
    const results = searchHorses(query);

    if (!results.length) {
      return interaction.reply({
        content: `Não encontrei nenhum cavalo para: **${query}**`,
        ephemeral: true,
      });
    }

    if (results.length === 1) {
      const embed = buildHorseEmbed(results[0]);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('horses:list')
          .setLabel('📋 Ver lista')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('horses:compare')
          .setLabel('⚔️ Comparar')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('horses:panel')
          .setLabel('🏠 Painel')
          .setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
      });
    }

    const limited = results.slice(0, 25);
    const select = new StringSelectMenuBuilder()
      .setCustomId('horses:select:0')
      .setPlaceholder(`Resultados para "${query}"`)
      .addOptions(
        limited.map((horse) => ({
          label: horse.nome.slice(0, 100),
          value: horse.id,
          description: formatHorseSummary(horse).slice(0, 100),
        })),
      );

    const embed = new EmbedBuilder()
      .setTitle('🔎 Resultado da pesquisa')
      .setDescription(`Encontrei **${results.length}** cavalo(s) para **${query}**.`);

    return interaction.reply({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('horses:panel')
            .setLabel('🏠 Painel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'horses:compareModal') {
    const horseAQuery = interaction.fields.getTextInputValue('horseA');
    const horseBQuery = interaction.fields.getTextInputValue('horseB');

    const horseA = findHorseByNameLoose(horseAQuery);
    const horseB = findHorseByNameLoose(horseBQuery);

    if (!horseA || !horseB) {
      const missing = [];
      if (!horseA) missing.push(`"${horseAQuery}"`);
      if (!horseB) missing.push(`"${horseBQuery}"`);

      return interaction.reply({
        content: `Não consegui localizar ${missing.join(' e ')}. Tente digitar o nome mais próximo do cavalo.`,
        ephemeral: true,
      });
    }

    const embed = buildCompareEmbed(horseA, horseB);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('horses:compare')
        .setLabel('⚔️ Nova comparação')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('horses:panel')
        .setLabel('🏠 Painel')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  }
}

module.exports = {
  horses,
  sendHorsePanel,
  handleHorseInteraction,
};