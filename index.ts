import {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, type Message, type Interaction, type TextChannel,
    Partials, DMChannel
} from 'discord.js';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';

dotenv.config();

// --- MONGODB SCHEMA ---
interface IParty extends mongoose.Document {
    partyId: string; criador: string; horario: string; membros: string[]; canalId: string;
}

const partySchema = new mongoose.Schema({
    partyId: String, criador: String, horario: String, membros: [String], canalId: String
});
const PartyModel = mongoose.model<IParty>('Party', partySchema);

// --- EXPRESS KEEP-ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_req: Request, res: Response) => res.send('🤖 Bot Online!'));
app.listen(Number(port), '0.0.0.0');

// --- CLIENT SETUP COM PARTIALS ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});

const SEU_ID_ADMIN = "1088425447760605275";
const CARGO_SANTUARIO_ID = "1466552837503975595";
const GUILD_ID = "1451560376461426905"; // Seu ID de servidor

// --- FUNÇÃO AGENDAR ---
function agendarNotificacoes(partyId: string, horario: string, canalId: string) {
    const timeParts = horario.split(':').map(Number);
    const h = timeParts[0]; const m = timeParts[1];
    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return;

    let dmMin = m - 15; let dmHora = h;
    if (dmMin < 0) { dmMin += 60; dmHora -= 1; }

    cron.schedule(`${dmMin} ${dmHora} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p?.membros.length) {
            for (const id of p.membros) {
                try {
                    const u = await client.users.fetch(id);
                    await u.send(`🤫 **SANTUÁRIO:** Faltam 15min para a PT das ${horario}!`);
                } catch (e) { console.error(`Erro DM para ${id}`); }
            }
        }
    }, { timezone: "America/Sao_Paulo" });

    cron.schedule(`${m} ${h} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p?.membros.length) {
            const channelRaw = await client.channels.fetch(canalId);
            if (channelRaw?.isTextBased()) {
                const canal = channelRaw as TextChannel;
                const mencoes = p.membros.map((id: string) => `<@${id}>`).join(', ');
                await canal.send(`⚔️ **HORA DO BOSS!** PT das ${horario}: ${mencoes}`);
                await PartyModel.deleteOne({ partyId });
            }
        }
    }, { timezone: "America/Sao_Paulo" });
}

client.once('ready', async () => {
    console.log(`🤖 Bot online como ${client.user?.tag}`);
    try {
        await mongoose.connect(process.env.MONGO_URI!);
        console.log("🍃 Conectado ao MongoDB Atlas");
    } catch (err) { console.error("❌ ERRO NO MONGO:", err); }
});

// Limpeza automática (3h AM)
cron.schedule('0 3 * * *', async () => {
    await PartyModel.deleteMany({});
    console.log("🧹 Limpeza concluída.");
}, { timezone: "America/Sao_Paulo" });

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    if (message.content === '!LimparBanco' && message.author.id === SEU_ID_ADMIN) {
        const res = await PartyModel.deleteMany({});
        return message.reply(`✅ Removidas ${res.deletedCount} PTs.`);
    }

    if (message.content.startsWith('!PtSantuario')) {
        const horario = message.content.split(' ')[1];
        if (!horario?.includes(':')) return message.reply('❌ Use: `!PtSantuario HH:mm`');

        const partyId = message.id;
        await PartyModel.create({
            partyId, criador: message.author.id, horario,
            membros: [message.author.id], canalId: message.channel.id
        });

        agendarNotificacoes(partyId, horario, message.channel.id);

        const embed = new EmbedBuilder()
            .setTitle('⚔️ BOSS SANTUÁRIO')
            .setDescription(`**Horário:** ${horario}\n**Membros:** (1/5)\n1. <@${message.author.id}>`)
            .setColor(0x0099FF);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('JOIN PT').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`leave_${partyId}`).setLabel('SAIR/CANCELAR').setStyle(ButtonStyle.Danger)
        );

        const canal = message.channel as TextChannel;
        await canal.send({ content: `📢 <@&${CARGO_SANTUARIO_ID}> Nova PT!`, embeds: [embed], components: [row] });
    }
});

// --- LÓGICA DE REAÇÕES (UNIFICADA) ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    // 1. Cargo Santuário (⛩️)
    const MSG_SANTUARIO_ID = "1466981759957860619";
    if (reaction.message.id === MSG_SANTUARIO_ID && reaction.emoji.name === "⛩️") {
        const member = await guild.members.fetch(user.id);
        await member.roles.add(CARGO_SANTUARIO_ID);
        console.log(`✅ Cargo Santuário concedido.`);
    }

    // 2. Recrutamento (Corvo 🐦‍⬛)
    const MSG_RECRUTAMENTO_ID = "1466987349555806331";
    const CARGO_NOVATO_ID = "1466986467397079274";
    if (reaction.message.id === MSG_RECRUTAMENTO_ID && reaction.emoji.name === "🐦‍⬛") {
        try {
            const mInstrucao = await user.send("🐦‍⬛ **RECRUTAMENTO:** Responda APENAS com o seu **Nome de Família** no jogo.");
            const canalDM = mInstrucao.channel as DMChannel;
            const filter = (m: Message) => m.author.id === user.id;
            const collector = canalDM.createMessageCollector({ filter, max: 1, time: 60000 });

            collector.on('collect', async (m: Message) => {
                const member = await guild.members.fetch(user.id);
                if (member) {
                    await member.setNickname(m.content);
                    await member.roles.add(CARGO_NOVATO_ID);
                    await user.send(`✅ Bem-vindo, **${m.content}**! Você é um membro oficial.`);
                }
            });
        } catch (e) { console.error("DM fechada.", e); }
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot || reaction.partial) return;
    if (reaction.message.id === "1466981759957860619" && reaction.emoji.name === "⛩️") {
        const guild = client.guilds.cache.get(GUILD_ID);
        const member = await guild?.members.fetch(user.id);
        await member?.roles.remove(CARGO_SANTUARIO_ID);
    }
});

// --- INTERACTION CREATE (BOTOES) CORRIGIDO ---
client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    const [acao, id] = interaction.customId.split('_');

    // CORREÇÃO DOS ERROS TS2769: Usamos o as string e validação de existência
    if (!id) return;
    const p = await PartyModel.findOne({ partyId: id as string });
    if (!p) return interaction.reply({ content: 'PT não encontrada.', ephemeral: true });

    if (acao === 'leave') {
        if (interaction.user.id === p.criador) {
            await PartyModel.deleteOne({ partyId: id as string });
            return interaction.update({ content: '❌ PT Cancelada.', embeds: [], components: [] });
        }
        p.membros = p.membros.filter(mId => mId !== interaction.user.id);
    } else if (acao === 'join') {
        if (p.membros.includes(interaction.user.id)) return interaction.reply({ content: 'Já está na PT!', ephemeral: true });
        if (p.membros.length >= 5) return interaction.reply({ content: 'Lotada!', ephemeral: true });
        p.membros.push(interaction.user.id);
    }
    await p.save();

    const lista = p.membros.map((mid, i) => `${i + 1}. <@${mid}>`).join('\n');
    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]!).setDescription(`**Horário:** ${p.horario}\n**Membros:** (${p.membros.length}/5)\n${lista}`);
    await interaction.update({ embeds: [newEmbed] });
});

client.login(process.env.DISCORD_TOKEN!);