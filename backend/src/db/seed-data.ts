// Synthetic reference lists and a seeded random generator for the development seed.
// Every name, phone number and document fragment is invented. Phone numbers use the
// non-dialable 00000 block and emails use reserved domains (.test / example.com).

/** Deterministic PRNG (mulberry32): the same seed always yields the same data. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    weighted: <T>(options: readonly (readonly [T, number])[]): T => {
      const total = options.reduce((s, [, w]) => s + w, 0);
      let roll = next() * total;
      for (const [value, weight] of options) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return options[options.length - 1]![0];
    },
    digits: (count: number) => Array.from({ length: count }, () => int(0, 9)).join(''),
    /** RFC 4122 version-4 shaped UUID built from the seeded generator. */
    uuid: () => {
      const hex = Array.from({ length: 32 }, () => int(0, 15).toString(16));
      hex[12] = '4';
      hex[16] = ((int(0, 15) & 0x3) | 0x8).toString(16);
      const h = hex.join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;

export const CITIES = [
  'Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore',
  'Thoothukudi', 'Thanjavur', 'Dindigul', 'Karur', 'Namakkal', 'Hosur', 'Kanchipuram', 'Cuddalore',
  'Nagercoil', 'Kumbakonam', 'Pollachi', 'Rajapalayam', 'Sivakasi', 'Pudukkottai', 'Karaikudi', 'Tiruppur',
  'Villupuram', 'Krishnagiri', 'Dharmapuri', 'Ooty', 'Theni', 'Ramanathapuram', 'Virudhunagar', 'Ariyalur',
  'Perambalur', 'Nagapattinam', 'Mayiladuthurai', 'Tiruvannamalai', 'Ranipet', 'Tenkasi', 'Kallakurichi',
  'Chengalpattu', 'Tiruvallur', 'Arakkonam', 'Gudiyatham', 'Ambur', 'Mettupalayam', 'Gobichettipalayam',
  'Bengaluru', 'Mysuru', 'Puducherry', 'Palakkad',
] as const;

export const FIRST_NAMES = [
  'Arun', 'Bala', 'Charan', 'Deepa', 'Ezhil', 'Farida', 'Ganesh', 'Hari', 'Indira', 'Jaya', 'Karthik',
  'Lakshmi', 'Mani', 'Nandhini', 'Pradeep', 'Priya', 'Ravi', 'Saranya', 'Senthil', 'Shalini', 'Suresh',
  'Tamil', 'Uma', 'Vasanth', 'Vijay', 'Yamuna', 'Anitha', 'Babu', 'Divya', 'Gokul', 'Kavitha', 'Murali',
  'Nirmala', 'Prakash', 'Revathi', 'Sathish', 'Selvi', 'Ramesh', 'Meena', 'Aravind',
] as const;

export const LAST_NAMES = [
  'Kumar', 'Raj', 'Murugan', 'Subramanian', 'Krishnan', 'Natarajan', 'Pandian', 'Rajendran', 'Sekar',
  'Selvam', 'Shankar', 'Srinivasan', 'Venkatesan', 'Arumugam', 'Balasubramanian', 'Chandran', 'Devaraj',
  'Ganesan', 'Jayaraman', 'Kannan', 'Mohan', 'Narayanan', 'Palani', 'Ramasamy', 'Saravanan', 'Thangaraj',
  'Velu', 'Iyer', 'Pillai', 'Nair',
] as const;

export const OCCUPATIONS = [
  'Vegetable vendor', 'Tailor', 'Auto driver', 'Small shop owner', 'Farmer', 'Dairy farmer', 'Weaver',
  'Electrician', 'Carpenter', 'Mechanic', 'Tea stall owner', 'Flower seller', 'Beautician', 'Plumber',
  'Fruit vendor', 'Tiffin centre owner', 'Mason', 'Painter', 'Courier delivery partner', 'Handicraft maker',
] as const;

export const STREETS = [
  'Gandhi Road', 'Nehru Street', 'Market Road', 'Temple Street', 'Bazaar Street', 'Station Road',
  'Kamarajar Salai', 'Anna Nagar 2nd Street', 'Bharathi Street', 'Main Road', 'Church Street', 'Mill Road',
] as const;

export const LOAN_PURPOSES = [
  'Working capital for shop', 'Buy a sewing machine', 'Purchase livestock', 'Repair auto-rickshaw',
  'Stock for festival season', 'Expand vegetable stall', 'Buy tools and equipment', 'Home business setup',
  'Purchase raw materials', 'Renovate shop front',
] as const;

export const EXPENSE_TEMPLATES: Record<string, { min: number; max: number; notes: string[] }> = {
  RENT: { min: 8000, max: 25000, notes: ['Monthly branch office rent'] },
  UTILITIES: { min: 800, max: 4500, notes: ['Electricity bill', 'Water charges'] },
  SALARIES: { min: 12000, max: 30000, notes: ['Field staff incentive payout', 'Part-time office assistant wages'] },
  TRAVEL: { min: 300, max: 3500, notes: ['Fuel for collection visits', 'Bus fare for field visits', 'Two-wheeler servicing'] },
  OFFICE_SUPPLIES: { min: 200, max: 2500, notes: ['Receipt books and stationery', 'Printer toner', 'Files and folders'] },
  MARKETING: { min: 500, max: 6000, notes: ['Pamphlet printing', 'Local newspaper advertisement'] },
  MAINTENANCE: { min: 400, max: 5000, notes: ['Fan repair', 'Office cleaning', 'Lock replacement'] },
  COMMUNICATION: { min: 199, max: 1500, notes: ['Mobile recharge for agents', 'Internet bill'] },
  OTHER: { min: 100, max: 2000, notes: ['Drinking water cans', 'Miscellaneous office expense'] },
};
