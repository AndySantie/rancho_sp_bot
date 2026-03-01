const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const cfg = require('./config.json');

if (!cfg.token || !cfg.clientId) {
  console.error('❌ Falta token e/ou clientId no config.json');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('minha_pasta')
    .setDescription('Cria/abre sua pasta privada de FARM'),

  new SlashCommandBuilder()
    .setName('armazenar')
    .setDescription('Registra um armazenamento (print obrigatório antes)'),

  new SlashCommandBuilder()
    .setName('meu_total')
    .setDescription('Mostra seus totais (geral)'),

  // STAFF
  new SlashCommandBuilder()
    .setName('total_funcionario')
    .setDescription('[STAFF] Mostra totais de um funcionário')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Funcionário')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resumo_dia')
    .setDescription('[STAFF] Mostra resumo do dia (por data YYYY-MM-DD opcional)')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Data no formato YYYY-MM-DD (opcional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('exportar_csv')
    .setDescription('[STAFF] Exporta registros em CSV por período')
    .addStringOption(opt =>
      opt.setName('inicio')
        .setDescription('Data inicial (YYYY-MM-DD)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('fim')
        .setDescription('Data final (YYYY-MM-DD)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('pagamento')
    .setDescription('[STAFF] Calcula o que está em aberto para um funcionário')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Funcionário')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('pagar')
    .setDescription('[STAFF] Fecha período como PAGO e gera recibo')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Funcionário')
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('valor')
        .setDescription('Valor manual (opcional). Se vazio, usa o valor calculado')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('[STAFF] Ranking por período (e item opcional)')
    .addStringOption(opt =>
      opt.setName('periodo')
        .setDescription('Período')
        .setRequired(true)
        .addChoices(
          { name: 'semana', value: 'semana' },
          { name: 'mes', value: 'mes' },
          { name: 'geral', value: 'geral' }
        )
    )
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Key do item (opcional) — ex: milho, trigo...')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('preco_lista')
    .setDescription('[STAFF] Lista preços atuais'),

  new SlashCommandBuilder()
    .setName('preco_set')
    .setDescription('[STAFF] Altera preço de um item')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Key do item (cfg.items[].key)')
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('valor')
        .setDescription('Novo preço')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cancelar_registro')
    .setDescription('[STAFF] Cancela um registro por ID')
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('ID do registro')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('motivo')
        .setDescription('Motivo do cancelamento')
        .setRequired(true)
    ),

  // NOVOS (STAFF)
  new SlashCommandBuilder()
    .setName('listar_registros')
    .setDescription('[STAFF] Lista registros (filtro por usuário/status)')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Filtrar por usuário (opcional)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('status')
        .setDescription('Filtrar por status (opcional)')
        .setRequired(false)
        .addChoices(
          { name: 'TODOS', value: 'TODOS' },
          { name: 'ABERTO', value: 'ABERTO' },
          { name: 'PAGO', value: 'PAGO' },
          { name: 'CANCELADO', value: 'CANCELADO' }
        )
    )
    .addIntegerOption(opt =>
      opt.setName('limite')
        .setDescription('Quantos registros mostrar (1 a 50). Padrão: 20')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName('cancelar_lote')
    .setDescription('[STAFF] Cancela vários registros por IDs (ex: 10,11,12)')
    .addStringOption(opt =>
      opt.setName('ids')
        .setDescription('IDs separados por vírgula (ex: 10,11,12)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('motivo')
        .setDescription('Motivo do cancelamento em lote')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('apagar_pasta')
    .setDescription('[STAFF] Apaga a pasta (thread) de farm (pela thread atual ou por usuário)')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Se quiser apagar a pasta de alguém específico (opcional)')
        .setRequired(false)
    ),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(cfg.token);

async function main() {
  try {
    if (cfg.guildId && String(cfg.guildId).trim()) {
      // Comandos por servidor (recomendado para testes)
      await rest.put(
        Routes.applicationGuildCommands(cfg.clientId, cfg.guildId),
        { body: commands }
      );
      console.log('✅ Slash commands (GUILD) atualizados com sucesso.');
    } else {
      // Comandos globais (demoram mais para propagar)
      await rest.put(
        Routes.applicationCommands(cfg.clientId),
        { body: commands }
      );
      console.log('✅ Slash commands (GLOBAL) atualizados com sucesso.');
    }
  } catch (e) {
    console.error('❌ Erro ao dar deploy dos comandos:', e);
    process.exit(1);
  }
}

main();