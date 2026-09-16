// Datele pentru mascare: prenumele dupa care se recunoaste o persoana in text, cuvintele care nu sunt nume
// (institutii, geografie, grade, luni) si rezervorul de nume false. Totul fara diacritice si cu litere mici:
// potrivirea se face pe forma normalizata, iar scrierea (majuscule) se ia de la cuvantul din document.

// Prenume intalnite in actele sistemului penitenciar din Republica Moldova. Lista nu e completa si nici nu
// poate fi: e doar una dintre cele trei cai de recunoastere (declansatori, prenume, nume cu MAJUSCULE).
const PRENUME_BARBATESTI = `
alexandru adrian anatol anatolie andrei anton artur augustin aurel aurelian boris bogdan calin cezar ciprian
constantin corneliu cornel cristian cristi daniel danu david denis dinu dmitrii dorin dumitru eduard efim
emanuel emil eugen fedor felix filip florin gabriel gavril gennadii george gheorghe grigore haralambie iacob
ian igor ilie ion ionel iulian iurie ivan laurentiu lazar leonid leonte liviu lucian ludmil marcel marin
marius maxim mihai mihail mircea nichifor nicolae nicolai nicu octavian oleg olimpiu ovidiu pavel petre
petru pavlic profir radu raul rodion roman ruslan sandu sava sergiu sergei serghei silviu simion sorin
stanislav stefan teodor tiberiu tudor valentin valeriu valerii vasile veaceslav viorel victor vitalie
vladimir vlad vsevolod zaharia iurii evgheni anatoli maxim arcadie alexei afanasie gheorghii grigorii
`.trim().split(/\s+/);

const PRENUME_FEMEIESTI = `
adriana alexandra alina ana anastasia anisoara angela aurelia camelia carolina caterina cezara clara
cornelia cristina daniela diana dina doina dorina ecaterina elena elizaveta emilia eugenia svetlana
felicia florentina galina gabriela ghenadia iulia inga ina irina iuliana larisa laura lidia liliana
liuba livia ludmila lucia luminita mahaela maria mariana marina marcela mihaela nadejda natalia nina
olesea olga oxana parascovia paulina petronela raisa rodica roxana ruxanda silvia simona sofia stela
svetlana tamara tatiana teodora valentina valeria vera veronica victoria viorica zinaida zinovia iulia
`.trim().split(/\s+/);

export const PRENUME = new Set([...PRENUME_BARBATESTI, ...PRENUME_FEMEIESTI]);
export const PRENUME_M = new Set(PRENUME_BARBATESTI);

// Cuvintele cu majuscula care NU sunt nume de persoana. Un fals pozitiv aici e scump: daca se mascheaza
// „Penitenciarul nr. 13”, modelul nu mai poate verifica denumirile oficiale.
export const NU_SUNT_NUME = new Set(`
administratia nationala penitenciarelor penitenciarul penitenciarului penitenciar institutia publica
ministerul justitiei internelor afacerilor apararii sanatatii muncii finantelor educatiei culturii
republica moldova romania ucraina federatia rusa chisinau balti bender cahul soroca orhei ungheni comrat
causeni criuleni straseni hincesti anenii noi taraclia edinet drochia floresti rezina telenesti singerei
donduseni ocnita briceni glodeni riscani falesti nisporeni calarasi dubasari ialoveni leova cantemir
cimislia basarabeasca stefan voda soldanesti rascani transnistria
curtea apel judecatoria suprema justitie procuratura generala politie inspectoratul departamentul
directia sectia serviciul biroul oficiul centrul comisia consiliul guvernul parlamentul presedintele
legea codul hotararea ordinul dispozitia regulamentul constitutia conventia protocolul anexa
ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie
luni marti miercuri joi vineri sambata duminica
domnul doamna domnului doamnei dumneavoastra stimate stimata subsemnatul prezenta prezentul
sef sefului sefa director directorul adjunct inspector inspectorul comisar locotenent capitan maior
colonel sergent plutonier sublocotenent general avocat avocatul procuror procurorul judecator judecatorul
detinutul condamnatul inculpatul invinuitul banuitul petitionarul reclamantul cetateanul numitul
administratiei ministerului directiei sectiei serviciului institutiei departamentului inspectoratului
republicii moldovei romaniei judecatoriei procuraturii curtii apelului guvernului parlamentului
balti soroca cahul apel central penal penala procedura sentinta decizia incheierea dosarul
centrului biroului oficiului comisiei consiliului nationale nationala penitenciarelor statului
nota informativa raport demers dispozitie proces verbal cerere sesizare referinta atentie documentul
articolul alineatul punctul litera capitolul sectiunea titlul numarul data anul luna ziua ora
idnp cnp asp anp cpi mai msmps ctas cnam sia sti ump pdf docx
`.trim().split(/\s+/));

// Declansatorii dupa care urmeaza aproape sigur un nume de persoana.
export const DECLANSATORI = `
dl dlui dna dnei dna-lui d-l d-lui d-na d-nei domnul domnului doamna doamnei cet cetateanul cetateanca
numitul numita numitului numitei condamnatul condamnata condamnatului condamnatei detinutul detinuta
detinutului detinutei inculpatul inculpata invinuitul invinuita banuitul banuita petitionarul petitionara
reclamantul reclamanta avocatul avocata subsemnatul subsemnata executat executa privinta
`.trim().split(/\s+/);

// Partea rusa a actelor e, de regula, antetul institutiei, scris tot cu majuscule. Acolo un nume se ia numai
// dupa un declansator rusesc, altfel „МИНИСТЕРСТВО ЮСТИЦИИ” ar deveni nume de om.
export const DECLANSATORI_RU = `
осужденный осужденного осужденному осужденная гражданин гражданина гражданке гражданину задержанный
обвиняемый обвиняемого подозреваемый подозреваемого заключенный заключенного потерпевший потерпевшего
г-н г-на г-жа г-же адвокат адвоката начальник начальника директор директора
`.trim().split(/\s+/);

// Gradele si functiile dupa care, in blocul de semnatura, vine un nume.
export const GRADE = `
sef sefa sefului director directorul directoarea adjunct inspector inspectorul comisar locotenent capitan
maior colonel sergent plutonier sublocotenent general specialist consultant psiholog medic educator
`.trim().split(/\s+/);

// ---------------------------------------------------------------- rezervorul de nume false
//
// Nume de familie moldovenesti care nu sunt si cuvinte obisnuite (ca sa nu strice cautarea reziduurilor) si
// prenume clar barbatesti / femeiesti (ca acordul din fraza sa ramana valabil dupa inlocuire).

export const NUME_FALSE = [
  "Chiriac", "Zaharia", "Ursachi", "Vicol", "Jardan", "Leahu", "Năstase", "Bejenaru", "Buzdugan", "Dohotaru",
  "Eremia", "Gorea", "Ababii", "Ojog", "Pintilie", "Rotari", "Tabacaru", "Mărăndici", "Sofronie", "Țurcanu",
  "Grecu", "Postică", "Șalaru", "Damaschin", "Onofrei", "Berzoi", "Cojocari", "Harea", "Melnic", "Obreja",
];

export const PRENUME_FALSE_M = [
  "Vasile", "Grigore", "Teodor", "Anatolie", "Filip", "Octavian", "Lazăr", "Iachim", "Sava", "Profir",
  "Haralambie", "Efim", "Nichifor", "Leonte", "Augustin", "Tiberiu",
];

export const PRENUME_FALSE_F = [
  "Zinovia", "Parascovia", "Ruxanda", "Filofteia", "Casiana", "Eufrosina", "Agripina", "Domnica",
  "Chiriachia", "Melania", "Sevastia", "Anisia", "Varvara", "Teodosia", "Haritina", "Paraschiva",
];
