import {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, type Message, type Interaction, type TextChannel
} from 'discord.js';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';

dotenv.config();

// --- MONGODB SCHEMA ---
interface IParty extends mongoose.Document {
    partyId: string;
    criador: string;
    horario: string;
    membros: string[];
    canalId: string;
}

const partySchema = new mongoose.Schema({
    partyId: String,
    criador: String,
    horario: String,
    membros: [String],
    canalId: String
});
const PartyModel = mongoose.model<IParty>('Party', partySchema);

// --- EXPRESS KEEP-ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_req: Request, res: Response) => res.send('🤖 Bot Online com MongoDB!'));
app.listen(Number(port), '0.0.0.0');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages
    ]
});

const SEU_ID_ADMIN = "1088425447760605275";
const CARGO_ID = "1466548804328358185";

// --- FUNÇÃO AGENDAR ---
function agendarNotificacoes(partyId: string, horario: string, membros: string[], canalId: string) {
    const timeParts = horario.split(':').map(Number);
    const h = timeParts[0];
    const m = timeParts[1];

    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return;

    let dmMin = m - 15;
    let dmHora = h;
    if (dmMin < 0) { dmMin += 60; dmHora -= 1; }

    cron.schedule(`${dmMin} ${dmHora} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p && p.membros) {
            for (const id of p.membros) {
                try {
                    const u = await client.users.fetch(id);
                    await u.send(`🤫 **SANTUÁRIO:** Faltam 15min para a PT das ${horario}!`);
                } catch (e) { console.error(`Erro DM para ${id}`); }
            }
        }
    });

    cron.schedule(`${m} ${h} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p && p.membros) {
            const channelRaw = await client.channels.fetch(canalId);
            // Fazemos o cast para TextChannel para garantir que o método .send() exista
            if (channelRaw && channelRaw.isTextBased()) {
                const canal = channelRaw as TextChannel;
                const mencoes = p.membros.map((id: string) => `<@${id}>`).join(', ');
                await canal.send(`⚔️ **HORA DO BOSS!** PT das ${horario}: ${mencoes}`);
                await PartyModel.deleteOne({ partyId });
            }
        }
    });
}

client.once('ready', async () => {
    console.log(`🤖 Bot online como ${client.user?.tag}`);
    try {
        console.log("⏳ Tentando conectar ao MongoDB...");
        if (!process.env.MONGO_URI) throw new Error("MONGO_URI não encontrada no .env!");

        await mongoose.connect(process.env.MONGO_URI);
        console.log("🍃 Conectado ao MongoDB Atlas");
    } catch (err) {
        console.error("❌ ERRO CRÍTICO NO MONGO:", err);
    }
});

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!WhisperAdmin') && message.author.id === SEU_ID_ADMIN) {
        const args = message.content.split(' ');
        const targetId = args[1];
        const texto = args.slice(2).join(' ');
        if (!targetId || !texto) return;
        try {
            const user = await client.users.fetch(targetId);
            await user.send(`✉️ **Mensagem da Administração:** ${texto}`);
            await message.react('✅');
        } catch (e) { console.error(e); }
        return;
    }

    if (message.content.startsWith('!PtSantuario')) {
        const horario = message.content.split(' ')[1];
        if (!horario?.includes(':')) return message.reply('❌ Use: `!PtSantuario HH:mm`');

        const partyId = message.id;
        await PartyModel.create({
            partyId,
            criador: message.author.id,
            horario,
            membros: [message.author.id],
            canalId: message.channel.id
        });

        agendarNotificacoes(partyId, horario, [message.author.id], message.channel.id);

        const embed = new EmbedBuilder()
            .setTitle('⚔️ BOSS SANTUÁRIO')
            .setDescription(`**Horário:** ${horario}\n**Membros:** (1/5)\n1. <@${message.author.id}>`)
            .setColor(0x0099FF);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('JOIN PT').setStyle(ButtonStyle.Success)
        );

        // Usamos o cast para garantir que o canal da mensagem atual permite o .send()
        const canalOriginal = message.channel as TextChannel;
        await canalOriginal.send({ content: `📢 <@&${CARGO_ID}> Nova PT!`, embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    const parts = interaction.customId.split('_');
    const acao = parts[0];
    const id = parts[1];
    if (acao !== 'join' || !id) return;

    const p = await PartyModel.findOne({ partyId: id });
    if (!p || !p.membros) return interaction.reply({ content: 'PT não encontrada.', ephemeral: true });

    if (p.membros.includes(interaction.user.id)) return interaction.reply({ content: 'Já está na PT!', ephemeral: true });
    if (p.membros.length >= 5) return interaction.reply({ content: 'Lotada!', ephemeral: true });

    p.membros.push(interaction.user.id);
    await p.save();

    const lista = p.membros.map((mid: string, i: number) => `${i + 1}. <@${mid}>`).join('\n');
    const embedOriginal = interaction.message.embeds[0];
    if (!embedOriginal) return;

    const newEmbed = EmbedBuilder.from(embedOriginal)
        .setDescription(`**Horário:** ${p.horario}\n**Membros:** (${p.membros.length}/5)\n${lista}`);

    await interaction.update({ embeds: [newEmbed] });
});

client.login(process.env.DISCORD_TOKEN!);