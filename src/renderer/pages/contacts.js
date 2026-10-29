import * as store from '../lib/store.js';
import { h, panel, editTable, table } from '../lib/ui.js';
import { NATIONAL_NUMBERS, suggestionsFor } from '../data/defaults.js';

const CATS = ['Household', 'Out-of-area contact', 'Family', 'Neighbour', 'Friend', 'GP surgery', 'Pharmacy', 'Hospital', 'Dentist', 'School / childcare', 'Work', 'Carer', 'Vet', 'Insurance', 'Trades', 'Council', 'Other'];

export function render(root) {
  const contacts = store.get('contacts');
  root.append(
    h('div', { class: 'stack' },
      panel('Your contacts', editTable([
        { key: 'category', label: 'Category', type: 'select', options: CATS, width: '150px' },
        { key: 'name', label: 'Name', width: '150px' },
        { key: 'relation', label: 'Relation / role', width: '120px' },
        { key: 'phone', label: 'Phone', width: '135px' },
        { key: 'alt', label: 'Alt phone', width: '135px' },
        { key: 'email', label: 'Email', width: '160px' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'ice', label: 'ICE', type: 'checkbox', width: '36px', title: 'In Case of Emergency contact' },
      ], contacts, () => store.save('contacts'), { addLabel: 'Add contact', newRow: () => ({ category: 'Other' }), suggestions: suggestionsFor('contacts'), emptyText: 'No contacts yet.' })),
      panel('National numbers', table([
        { label: 'Service', key: 'name' },
        { label: 'Number', get: (r) => h('b', { class: 'mono nowrap' }, r.number) },
        { label: 'When to use', get: (r) => h('span', { class: 'small muted' }, r.notes) },
      ], NATIONAL_NUMBERS))));
}
