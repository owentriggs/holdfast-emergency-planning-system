// Radio frequency presets. Broadcast frequencies vary by transmitter: confirm local ones with a radio or the
// station's website and add them to "My frequencies". Two-way radio: transmit only on licence-free bands
// unless you hold the relevant licence.

const pmr = Array.from({ length: 16 }, (_, i) => ({
  band: 'PMR446', service: `PMR446 channel ${i + 1}`, freq: (446.00625 + i * 0.0125).toFixed(5), unit: 'MHz', mode: 'FM (analogue)',
  licence: 'Licence free', use: i === 7 ? 'Ch 8 often used as a general calling channel' : i === 0 ? 'Ch 1 common default on cheap handsets' : '',
}));

const cbUk = [1, 9, 14, 19, 40].map((ch) => ({
  band: 'CB 27/81 (UK FM)', service: `UK CB channel ${ch}`, freq: (27.60125 + (ch - 1) * 0.01).toFixed(5), unit: 'MHz', mode: 'FM',
  licence: 'Licence free', use: ch === 9 ? 'Emergency channel' : ch === 14 ? 'Traditional UK calling channel' : ch === 19 ? 'Road users / calling' : '',
}));

const CEPT = { 1: 26.965, 9: 27.065, 19: 27.185, 40: 27.405 };
const cbEu = Object.entries(CEPT).map(([ch, f]) => ({
  band: 'CB CEPT (EU FM)', service: `EU CB channel ${ch}`, freq: f.toFixed(3), unit: 'MHz', mode: 'FM/AM',
  licence: 'Licence free', use: ch === '9' ? 'Emergency channel' : ch === '19' ? 'Calling / road users' : '',
}));

export const RADIO_PRESETS = [
  { band: 'Broadcast FM', service: 'BBC Radio 4', freq: '92.4 - 94.6', unit: 'MHz', mode: 'FM', licence: 'Receive', use: 'National news. Exact frequency depends on transmitter.' },
  { band: 'Broadcast FM', service: 'BBC Radio 2', freq: '88.1 - 90.2', unit: 'MHz', mode: 'FM', licence: 'Receive', use: 'National, regular news bulletins.' },
  { band: 'Broadcast FM', service: 'BBC Radio Wales', freq: '93 - 104', unit: 'MHz', mode: 'FM', licence: 'Receive', use: 'Wales news and travel. Varies widely by area: find local frequency.' },
  { band: 'Broadcast FM', service: 'BBC Radio Cymru', freq: '92 - 105', unit: 'MHz', mode: 'FM', licence: 'Receive', use: 'Welsh language. Varies by area.' },
  { band: 'Broadcast FM', service: 'Classic FM', freq: '99.9 - 101.9', unit: 'MHz', mode: 'FM', licence: 'Receive', use: 'National, hourly news.' },
  { band: 'Broadcast AM', service: 'BBC Radio 5 Live', freq: '693 / 909', unit: 'kHz', mode: 'MW', licence: 'Receive', use: 'National news and sport. MW reaches further at night.' },
  { band: 'Broadcast AM', service: 'BBC Radio 4 Long Wave', freq: '198', unit: 'kHz', mode: 'LW', licence: 'Receive', use: 'Very wide coverage. BBC has announced LW closure: check it is still on air.' },
  { band: 'Broadcast AM', service: 'talkSPORT', freq: '1053 / 1089', unit: 'kHz', mode: 'MW', licence: 'Receive', use: 'National MW, hourly news.' },
  ...pmr,
  ...cbUk,
  ...cbEu,
  { band: 'Amateur (licence required)', service: '2 m FM calling', freq: '145.500', unit: 'MHz', mode: 'FM', licence: 'Ofcom amateur licence to transmit', use: 'Calling frequency. Listening is allowed.' },
  { band: 'Amateur (licence required)', service: '70 cm FM calling', freq: '433.500', unit: 'MHz', mode: 'FM', licence: 'Ofcom amateur licence to transmit', use: 'Calling frequency.' },
  { band: 'Amateur (licence required)', service: 'RAYNET', freq: 'local', unit: '', mode: '', licence: 'Amateur licence', use: 'Volunteer emergency comms network; local groups support emergency services.' },
];
