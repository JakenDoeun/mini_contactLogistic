// Sample parcels shared by the browser preview (parcel-service.ts) and the development database seed
// (src/server/db/seed.ts). Fictional names, codes and phone numbers. No imports, so plain Node can load it.
// Each line exercises a rule: name variants on one phone, same name on two phones, a failed SMS
// followed by a reached call, a combined SMS plus a later arrival, and repeated missed calls.
export const SAMPLE_PARCELS: [code: string, recipient: string, phone: string, importedHoursAgo: number][] = [
  ['CB4810276635', 'Sokha Chan', '+855 12 345 678', 1.5],
  ['CB2291048871', 'Chan Sokha', '012-345-678', 1.5],
  ['CB7730192245', 'Sokha C.', '012345678', 26],
  ['CB5528814023', 'Dara Kim', '096 555 2041', 26],
  ['CB9014425560', 'Dara Kim', '097 880 1123', 1.5],
  ['CB3365701198', 'Srey Pich Lim', '088 412 7730', 50],
  ['CB6602917734', 'Lim Sreypich', '088 412 7730', 50],
  ['CB1187420096', 'Srey Pich Lim', '088 412 7730', 1.5],
  ['CB8843016652', 'Vibol Sok', '010 223 908', 26],
  ['CB4419830027', 'Rachana Heng', '070 556 112', 2.5],
  ['CB2075519384', 'Bopha Ly', '015 774 320', 2.5],
  ['CB6138842210', 'Piseth Ouk', '081 330 5512', 2.5],
  ['CB9952007461', 'Monyrath Seng', '092 618 044', 23],
  ['CB3307716659', 'Kanha Prak', '016 902 377', 1.5],
  ['CB5190386627', 'Theary Nhem', '077 245 860', 1.5],
  ['CB7461120983', 'Sopheak Tan', '085 119 004', 50],
  ['CB8226650317', 'Sopheak Tan', '085 119 004', 1.5],
  ['CB1950442876', 'Ratanak Pov', '011 650 293', 23],
  ['CB6650213387', 'Sreyleak Nov', '', 2.5], // the export left the phone blank
];
