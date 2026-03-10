
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

function buildHorseEmbed(horse) {
  return new EmbedBuilder()
    .setTitle(`🐎 ${horse.nome}`)
    .setDescription('Consulta completa do cavalo selecionado.')
    .addFields(
      { name: '❤️ Vida', value: String(horse.vida), inline: true },
      { name: '⚡ Estamina', value: String(horse.estamina), inline: true },
      { name: '🛡️ Coragem', value: String(horse.coragem), inline: true },
      { name: '🪶 Agilidade', value: String(horse.agilidade), inline: true },
      { name: '💨 Velocidade', value: String(horse.velocidade), inline: true },
      { name: '🔥 Aceleração', value: String(horse.aceleracao), inline: true },
      { name: '🌦️ Clima', value: horse.clima, inline: true },
      { name: '📊 Total', value: String(horse.total), inline: true },
      { name: '⚖️ Peso', value: String(horse.peso), inline: true },
      { name: '💰 Valor', value: horse.valorTexto || moneyBr(horse.valorNumero), inline: true },
    )
    .setFooter({ text: `ID interno: ${horse.id}` });
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

function buildHorseSelectPage(page = 0, filtered = sortByName(horses)) {
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`horses:select:${safePage}`)
    .setPlaceholder(`Escolha um cavalo (${filtered.length} encontrados)`)
    .addOptions(
      slice.map((horse) => ({
        label: horse.nome.slice(0, 100),
        value: horse.id,
        description: `Total ${horse.total} • ${horse.clima} • ${horse.valorTexto}`.slice(0, 100),
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
    .setTitle('🐎 Consultar cavalo')
    .setDescription(`Página **${safePage + 1}/${totalPages}** • Escolha um cavalo na lista abaixo.`);

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
        .setCustomId('horses:ranking')
        .setLabel('🏆 Top total')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('horses:climate')
        .setLabel('🌦️ Ver por clima')
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

    if (id === 'horses:ranking') {
      const embed = buildSimpleListEmbed('🏆 Top cavalos por total', topHorsesByTotal(15));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('horses:panel')
          .setLabel('🏠 Voltar')
          .setStyle(ButtonStyle.Secondary),
      );

      return interaction.update({ embeds: [embed], components: [row] });
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
          description: `Total ${horse.total} • ${horse.clima} • ${horse.valorTexto}`.slice(0, 100),
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
}

module.exports = {
  horses,
  sendHorsePanel,
  handleHorseInteraction,
};
