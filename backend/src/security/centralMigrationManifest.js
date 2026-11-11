const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const migrationsRoot = path.resolve(__dirname, "../../database/central/migrations");
const manifest = Object.freeze([
  Object.freeze({
    version: "000_central_identity_baseline",
    irreversible: true,
    acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "c84130a6eca83c4ec4b4e2573e4e6d7ba2f2babda0c12f815338f362c9afed9b"
  }),
  Object.freeze({
    version: "001_f2_oidc_sessions",
    irreversible: false,
    acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "a8f275f882ccea244b347be19d858a93eb95f2552772cb0f9c4954a584c3da6a"
  }),
  Object.freeze({
    version: "002_f3_organization_memberships",
    irreversible: false,
    acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "4ffd0af79449c34c7d4e31ba8093c0af80a97b79a454003ff1d0ac6fa720aa27"
  }),
  Object.freeze({
    version: "003_f4_tenant_directory",
    irreversible: false,
    acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "103676f0452fa7298bee11b95d8b8f1f1c58b7bb14e80e9109ed3cdfeaaeb4d8"
  }),
  Object.freeze({
    version: "004_f9_async_execution", irreversible: false, acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "e7742cea06db8e6f82a2ecdf44bcab831b24da41aa0b4424fb7f3109ddc3378a"
  }),
  Object.freeze({
    version: "005_f7_append_only_audit", irreversible: false, acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "d10315232704a535c202d870341f1090bd63843d960a0cc8ea80526b140f29de"
  }),
  Object.freeze({
    version: "006_f12_opportunity_catalog", irreversible: false, acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "02fecb5b6fd069ba1f78a60bd78799f59791b31db776a6c844bbf1d9a9620d1f"
  }),
  Object.freeze({
    version: "007_f9_execution_lineage", irreversible: false, acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "4b725e48042abaf21401e4cb6fed600923480e9428d44c571e54d224a267f83c"
  }),
  Object.freeze({
    version: "008_f44_tenant_workload_identity", irreversible: false, acceptsHistoricalCrlfChecksum: true,
    schemaFingerprint: "5b4db16a53f0907113061ef045bfd87ae7abc694cd86fca4f637ee19ffb71780"
  }),
  Object.freeze({
    version: "009_authority_commit_guard", irreversible: false, acceptsHistoricalCrlfChecksum: false,
    upChecksum: "ac647889866689c44887df39db2b63393a1fcf600031a184729cf53ef46376ce",
    downChecksum: "5b0621f15506bfb301f9e76ef3f7f08c05925c4255ce0c849bfc3ff8f14b6e4f",
    schemaFingerprint: "9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581",
    authoritySecurityFingerprint:"4da6e49668d6c8620951291c9a6fad558731cd2f5d10c2b2770086e6914f2fe0"
  }),
  Object.freeze({
    "version": "010_editorial_intention_lookup",
    "irreversible": false,
    "acceptsHistoricalCrlfChecksum": false,
    "upChecksum": "e5471d8847251aaeeb1e1c5c87418b14aeb3752976a2a9811a085dca58b2e0b6",
    "downChecksum": "86b94bb55af832725c8eb57803a4f556d0599cb3e444987cc57ad161150cf119",
    "schemaFingerprint": "b8ee050f52c1cb905d2afc6f5c1404220c76d9e1351f9b98bdf9efbeeabcab7d",
    "authoritySecurityFingerprint": "06520d7967c1663e369a67c87b6b3c5af060c425a714b63953514552c2e176cf"
}),
Object.freeze({"version":"011_criteria_intention_lookup","irreversible":false,"acceptsHistoricalCrlfChecksum":false,"upChecksum":"0049858a09df7baae9f5ac7e40575b85b3f5b99c621fe1613236685f0ac3976a","downChecksum":"e491849c6f6845a072f3628e1d222eddc39ad02540d5da1b15c6403ad072c807","schemaFingerprint":"d1dea2dc3d1ec3ee81fd876036ab2caca826853f8bc4325ccb645205ce187d2c","authoritySecurityFingerprint":"bc726a44faf8de5cd4602c9caa6f586601d5a544373b958ae6da8640e1fb81bb"}),
Object.freeze({"version":"012_pq1_intention_lookup","irreversible":false,"acceptsHistoricalCrlfChecksum":false,"upChecksum":"c51f07df2bfb1c8c92720eecc23fa2085bdc5093ac6677b23f493030c85f7eea","downChecksum":"0049858a09df7baae9f5ac7e40575b85b3f5b99c621fe1613236685f0ac3976a","schemaFingerprint":"d8ec4990c6c35b454725de1de7f78e7438e02dc0d3035313ffdb5b94770c9187","authoritySecurityFingerprint":"3a9b36b8cae72bc1df7c343b64f5106fe697f8d7111e1ec51371797c78a7d268"}),
Object.freeze({"version": "013_pq1_effective_lookup", "irreversible": false, "acceptsHistoricalCrlfChecksum": false, "upChecksum": "5431b18c567deaf4cb35e6f63d8cd7c012c92f5eab8400bddaa8147473136333", "downChecksum": "c51f07df2bfb1c8c92720eecc23fa2085bdc5093ac6677b23f493030c85f7eea", "schemaFingerprint": "b23695fb8c588208bea29e421656625f6922ee1a71f0b713356ab2ec57b8ead8", "authoritySecurityFingerprint": "2065bfc28e43042a9d8e5d0da32b9de111f8b99942935890c8a68694b660b9fc"}),
Object.freeze({"version": "014_pq1_decision_lookup", "irreversible": false, "acceptsHistoricalCrlfChecksum": false, "upChecksum": "5b61c5a88d4011464b96356c1d91e4ee7f814db2dfe9de0942f6086cccf2681c", "downChecksum": "5431b18c567deaf4cb35e6f63d8cd7c012c92f5eab8400bddaa8147473136333", "schemaFingerprint": "8ec56cf7d4c24ccf2d28d88d26f5cedfc6d62847d617849d2a3298d403b5dced", "authoritySecurityFingerprint": "43eb5e6b4c1b0529b0f386dfb2c1944392d5c459ba4aa8645560c7ff2ba675bf"}),
Object.freeze({version:'015_funding_tenders_central',irreversible:true,acceptsHistoricalCrlfChecksum:false,upChecksum:'5ffbc8f08b7242e33449337dba7dbaedcf227737cb2095bc9d0837d7442a11d4',downChecksum:'1be44c02d8c11339942cf3f13086e66da13d551591e5d335efccdc291776f5a9',schemaFingerprint:'08f025d3ac0c15d5d4c60a41bcf5e00fc916dc20c461d788c515d17a387028a3',authoritySecurityFingerprint:'43eb5e6b4c1b0529b0f386dfb2c1944392d5c459ba4aa8645560c7ff2ba675bf'}),
Object.freeze({version:'016_membership_access',irreversible:false,acceptsHistoricalCrlfChecksum:false,upChecksum:'baa9e57c455bbc50bf7b357e3f9f70bac956e1df60c7dc9f1133dbc51743988a',downChecksum:'8ef0c75fe5ab33c64ec1c0c45a83730362f183a7c3f9b7b0a7d905a628faf68e',schemaFingerprint:'8adad2fda4d5752a620ec88f867b94a8c6e530fe0c09ead8df683fbb252aba5d',authoritySecurityFingerprint:'0732829a2a77795ec2451976214d64c093fc3652a46876fd7abd05e60c8a5095'}),
Object.freeze({"version":"017_funding_programmes","irreversible":false,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"9aa71c81570624df1c50c6de08c3dddfbcaec024c39c1c5e82fa51b3171f78c3","authoritySecurityFingerprint":"0732829a2a77795ec2451976214d64c093fc3652a46876fd7abd05e60c8a5095","upChecksum":"41e183f9888dd55f52567475d19dd1e3295687b8c63d53fc9edca6b1698b17dc","downChecksum":"ee5e6a5c7f3333df4e367aff7eac95d591935d03eda603893659706c7b24244e"}),
Object.freeze({"version":"018_official_programme_sources","irreversible":false,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"bbc2c57d8536355a3d797fc7d7450c98e77ce7334ceb2de8ce5486ad30ba8bdd","authoritySecurityFingerprint":"0732829a2a77795ec2451976214d64c093fc3652a46876fd7abd05e60c8a5095","upChecksum":"fad887d7f5a1dc2269aacd1ab4605538783adeee8ec947fbceb203c950a2e1f1","downChecksum":"dde0dd29c08d43ea7fe6b25f6ec3d49c490649d5185a435fc74238cd7ae0a691"})
,Object.freeze({"version":"019_internal_access_profiles","irreversible":false,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"8c97cc3bc234b264299c783237f11a1a74ae970b80bc6f46cf70f462bd584bc4","authoritySecurityFingerprint":"064886b322d28ba542cd5d5c2cd51427f3874a85bc1f982d9a6e476dcd04919d","upChecksum":"024b47f4a74ff913580cd932716f69a881a088518e6337382768a6079988a268","downChecksum":"baa9e57c455bbc50bf7b357e3f9f70bac956e1df60c7dc9f1133dbc51743988a"})
,Object.freeze({"version":"020_platform_onboarding","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"27b1597eb76fe0641e811cd23ff99c65ae977eef15809254f6db1c5dd12d2b27","authoritySecurityFingerprint":"95985a00db2bfd59473ce9bfb0960712458bc727a6b7ea2431b6c87c203589fa","upChecksum":"08ec2e41971fa023c93c11a9da5ddd424ad249ddd49e3a7f323ace702f7f3b02"})
,Object.freeze({"version":"021_platform_members","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"b7f75b3f4e87e0565a74a0dbd40f302ca38c7e1eb9f09b298c5274ae97fda163","authoritySecurityFingerprint":"5703d7960ceced759771c287a7f381070828fe60936652b7fb58ea4bcbf2d70c","upChecksum":"57a56af149dd39cfde4f4cc63329acbf506c748b3e154e1482d373f9abf4472c"})
,Object.freeze({"version":"022_entity_admission","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"6b38ba878d8cc0f7548f750adce3c84e3bd997b4e9e841c90d6caec9d751103f","authoritySecurityFingerprint":"04689c2cdc9672fbe286aa3c39880b15f077ceee568ba7d553b5c7a8c5cda98b","upChecksum":"7c8212fb473f4bb0712b4fc20228b6d286ac339ea6334472342f4a09c55c76dd"})
,Object.freeze({"version":"023_entity_registration_draft","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"722612170f5fdf9b723cfebb2127705cb137f9c11cb2be459dd5e6bafa57e6b7","authoritySecurityFingerprint":"f6a8b6442f6bd86575409ad3d1fbb4a47819d7d0d0265896c1e12c55a8c54089","upChecksum":"491d54080de1a7f831751fac9d8a87da34cfefc0d595bd05495015030d5a66e5"})
,Object.freeze({"version":"024_organization_registration","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"8723effa5e52770df8dc3d3a5249c4c080cb85ebbdf974edea2572577fc540a5","authoritySecurityFingerprint":"dd197424beceedfe0ee4a5b0be39c5260baab84d9fac890f8ae129c76c25eeea","upChecksum":"2f6325a4230317969e877d32bfbb0f5c9d5e8948926806d1e312021e6fa3297f"})
,Object.freeze({"version":"025_entity_admission_completion","irreversible":true,"acceptsHistoricalCrlfChecksum":false,"schemaFingerprint":"e792bd5c626655a1af8651beb6e20146db511994e7ba779cfedca04a1775c07e","authoritySecurityFingerprint":"c2bb486fc0f8bc7d7cbafa97c15d2fc771a037b04c9192f6cbb78f634387d3da","upChecksum":"8c5e64e189bb9b9e70158d2d12e8bf2ca277b2406cedda32bc7b053548a09df9"}),
  Object.freeze({
  "version": "026_platform_logs",
  "irreversible": true,
  "acceptsHistoricalCrlfChecksum": false,
  "schemaFingerprint": "1980f4d6d94cbfd239950b1c605afce4f8501915b4ce8d082a0d88518883c638",
  "authoritySecurityFingerprint": "c2bb486fc0f8bc7d7cbafa97c15d2fc771a037b04c9192f6cbb78f634387d3da",
  "upChecksum": "aa1e6d2acea55403e709ef1b03fb48e72984e548f9b9d86df6740f1286348760"
}),
Object.freeze({
  "version": "027_platform_billing",
  "irreversible": true,
  "acceptsHistoricalCrlfChecksum": false,
  "schemaFingerprint": "21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b",
  "authoritySecurityFingerprint": "6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243",
  "upChecksum": "8f6f39cc106073452ffe9f206ae19b771f267d48eef96c684bb5f084e727f0a9"
}),
Object.freeze({
  version: '028_catalog_identity_authority', irreversible: true,
  requiresPreflightVersion: '027_platform_billing', acceptsHistoricalCrlfChecksum: false,
  requiresCatalogSecurityFingerprint: 'a71149cae4cca23eec8810b92fb5b03f1b4552c4c26dbf5d30423b6f2bfb6815',
  upChecksum: '13731a2618a5b9c14fc012165a543bcac73b69747f0aeff6c28ba369c0624212',
  schemaFingerprint: '30242c9704428629efb4b661e6062267a05b261aa525a0a029376be71b94a596',
  authoritySecurityFingerprint: 'b55a1fbf4f040ebd116a3ad5284a73c149fc04a0bd1b919238dc50ef765ea240',
  catalogSecurityFingerprint: 'd0e044b06b227da3d8216ada56b54d3a7ab61272794e7bc98528841f04ff4c25'
}),
Object.freeze({
  version:'029_catalog_reader',irreversible:true,requiresPreflightVersion:'028_catalog_identity_authority',
  requiresCatalogSecurityFingerprint:'d0e044b06b227da3d8216ada56b54d3a7ab61272794e7bc98528841f04ff4c25',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'3b90dcc49f7e53c342b5be8cd4bb99729000a92a3a302ba443c0a45aec91d0bc',
  schemaFingerprint:'248f1c3b50b5c887158e66de0e64aaea1ddc9fb978295685b79324d2542ac8b8',
  authoritySecurityFingerprint:'b55a1fbf4f040ebd116a3ad5284a73c149fc04a0bd1b919238dc50ef765ea240',
  catalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084'
}),
Object.freeze({
  version:'030_application_responsibles',irreversible:true,requiresPreflightVersion:'029_catalog_reader',
  requiresCatalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'9e2f08d2cc0b013b5f25a889307b4ffcf6c896ce0d71b6fdf5a206fa67a6237f',
  schemaFingerprint:'e815fd08ecde12637bc641869b66bcef33518bd4fc94d0caf504e71396baf630',
  authoritySecurityFingerprint:'1f116eca8bf5e0d6cf25c286fb50195973ca9908764729df6f954da57011468a',
  catalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084'
}),
Object.freeze({
  version:'031_tenant_directory_resolution',irreversible:true,requiresPreflightVersion:'030_application_responsibles',
  requiresCatalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'e0a16c77b5a90548206e980c3ef658a99ca2ff213ad776e2eb3b609d18b71062',
  schemaFingerprint:'ce2b9e43475c2c6d81ef0d9ef37aba93356c6f945a91acd30265cbc795826c82',
  authoritySecurityFingerprint:'af32fd14953b0fcf8cb2395001d77416f3cf96ca02eedbe06f2c8e3f97c8e731',
  catalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084'
}),
Object.freeze({
  version:'032_single_organization_membership',irreversible:true,requiresPreflightVersion:'031_tenant_directory_resolution',
  requiresCatalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'2f19b8f22a586eeab967d7374e8967a5ad626f27f1712654269d51433d3ba2c2',
  schemaFingerprint:'18f818779aa10ea673f34263b1f8386388d4ae3ad8d3edd0db24106b11b10497',
  authoritySecurityFingerprint:'78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b',
  catalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084'
}),
Object.freeze({
  version:'033_funding_coverage',irreversible:true,requiresPreflightVersion:'032_single_organization_membership',
  requiresCatalogSecurityFingerprint:'2c8e1af3ec8ac9de2eb9550bcb94726db38010d9635d15957844e5e51e8a3084',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'635b02beaf8257a413b0c951f71e1b0a54502fb438864072591fb002357c2c9e',
  schemaFingerprint:'4741902f45e29720d75983615a4674788f5a66c3e4618714433a22ba03965db5',
  authoritySecurityFingerprint:'78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b',
  catalogSecurityFingerprint:'1a392e3e3b91cb29ced7a397db4784c062c711e78106f4778a71f76fec99b563'
}),
Object.freeze({
  version:'034_funding_temporal_refresh',irreversible:true,requiresPreflightVersion:'033_funding_coverage',
  requiresCatalogSecurityFingerprint:'1a392e3e3b91cb29ced7a397db4784c062c711e78106f4778a71f76fec99b563',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'5cd4f5ffefad52d6910379440d6943ba10c1474a964dd2648b0e43d7fe15ece7',
  schemaFingerprint:'8ea865c2b7bd74db48869da34fbb256a12910f8a58d63896707ff4926369343a',
  authoritySecurityFingerprint:'78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b',
  catalogSecurityFingerprint:'59403d0bee7113896001ba0974535a0bacacffbcdfa70d509c90ae5c472a1638'
}),
Object.freeze({
  version:'035_funding_source_resolution',irreversible:true,requiresPreflightVersion:'034_funding_temporal_refresh',
  requiresCatalogSecurityFingerprint:'59403d0bee7113896001ba0974535a0bacacffbcdfa70d509c90ae5c472a1638',
  acceptsHistoricalCrlfChecksum:false,
  upChecksum:'a621ed6763c6f59f668d0bca4b9b7cb91bb65cd47c73ae1ba258021a58ca76c5',
  schemaFingerprint:'8b772f6cd36d2abb4bf9a69ddc553230f827d97400ef1ac0c7e8f98f69bd649e',
  authoritySecurityFingerprint:'78509ec8a5d7ca7682c29c5fd0a8b15c42423bda969ca6fa6024be1061216b2b',
  catalogSecurityFingerprint:'b0676b4c7a82eea86f8cf7d8f9b56cbfbac18b2dce8efd80860f193acaaacbc5'
})
]);

const { centralEntries } = require('./opportunityV2MigrationPackage');
const registeredManifest = Object.freeze([...manifest, ...centralEntries]);
const writerEntry = require('./opportunityEuWriterMigrationPackage').entry;
const writerManifest = Object.freeze([...registeredManifest, writerEntry]);
const reconciliationEntry = require('./opportunityEuReconciliationMigrationPackage').entry;
const reconciliationManifest = Object.freeze([...writerManifest, reconciliationEntry]);
const prearchiveEntry = require('./opportunityEuLegacyPrearchiveMigrationPackage').entry;
const prearchiveManifest = Object.freeze([...reconciliationManifest, prearchiveEntry]);
const catalogReadEntries = require('./catalogReadMigrationPackage').entries;
const catalogReadManifest = Object.freeze([...prearchiveManifest, ...catalogReadEntries]);
const centralImportEntry = require('./centralImportMigrationPackage').entry;
const centralImportManifest=Object.freeze([...catalogReadManifest,centralImportEntry]);
const billingPdfEntry=require('./billingPdfMigrationPackage').entry;
const knownManifest = Object.freeze([...centralImportManifest,billingPdfEntry]);
const receiptEntry = Object.freeze({
  ...manifest.at(-1), version: '036_f12_service_authority',
  requiresPreflightVersion: manifest.at(-1).version,
  requiresCatalogSecurityFingerprint: manifest.at(-1).catalogSecurityFingerprint,
  upChecksum: '4e3a48103a448858c17e4dba0be7a563eba763ea667951b9d134e2e73edb7779',
  schemaFingerprint: 'e0ada7d3cbbd2385d0015a4b8739b32af0321191a4f80578be51064a9d865f19'
});
const receiptManifest = Object.freeze([...manifest, receiptEntry]);
const replayCapacityEntry = Object.freeze({
  ...receiptEntry, version: '037_f12_replay_capacity',
  requiresPreflightVersion: receiptEntry.version,
  upChecksum: 'efa1dd848b106bdaee0264e2a30088a25db3992430d5055035f625d60d81605e',
  schemaFingerprint: 'a91ff016feead497609e5e3067343f863e5ac26a02981f1334508cbf35f4cfb7',
  authoritySecurityFingerprint: 'c13ce115dcc80bf42574ec831f8603a571dfb7e53d2f8169488773131fb6bc92'
});
const replayCapacityManifest = Object.freeze([...receiptManifest, replayCapacityEntry]);
const failureCapacityEntry = Object.freeze({
  ...replayCapacityEntry, version: '038_f12_replay_failure_capacity',
  requiresPreflightVersion: replayCapacityEntry.version,
  upChecksum: 'ce1bc7a1219351027e7eeb749de7e071e5b17bf63c6f98e41bcca0eaa79c7bca',
  schemaFingerprint: 'ee681abdb069c65117f7de58add9635be3ae62366996304e8096c7465af8b5d6'
});
const failureCapacityManifest = Object.freeze([...replayCapacityManifest, failureCapacityEntry]);
const allKnownMigrations = Object.freeze([...knownManifest, receiptEntry, replayCapacityEntry, failureCapacityEntry]);

function canonicalizeMigrationSql(sql) {
  if (typeof sql !== "string") throw new TypeError("Central migration SQL must be UTF-8 text.");
  return sql.replace(/\r\n/g, "\n");
}

function checksumSql(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function migrationChecksumPolicy(sql, { acceptsHistoricalCrlfChecksum = false } = {}) {
  const canonicalSql = canonicalizeMigrationSql(sql);
  const checksum = checksumSql(canonicalSql);
  const acceptedChecksums = new Set([checksum]);
  if (acceptsHistoricalCrlfChecksum) {
    acceptedChecksums.add(checksumSql(canonicalSql.replace(/\n/g, "\r\n")));
  }
  return Object.freeze({
    sql: canonicalSql,
    checksum,
    acceptedChecksums: Object.freeze([...acceptedChecksums])
  });
}

// Migration sources are immutable release artefacts, like the modules that pin
// their checksums. Reading and hashing them again on every request preflight
// only spent CPU on the API thread; the database evidence is still collected
// fresh by each caller. Injected readers are never cached.
const readMigrationFile = file => fs.readFileSync(file, "utf8");
const loadedMigrationSql = new Map();
function migrationSql(version, direction, readSql = readMigrationFile) {
  if (readSql !== readMigrationFile) return sourceMigrationSql(version, direction, readSql);
  const key = `${version}
${direction}`;
  let loaded = loadedMigrationSql.get(key);
  if (!loaded) { loaded = Object.freeze(sourceMigrationSql(version, direction, readSql)); loadedMigrationSql.set(key, loaded); }
  return { ...loaded };
}

function sourceMigrationSql(version, direction, readSql) {
  const entry = allKnownMigrations.find(item => item.version === version);
  if (!entry) throw new Error(`Unknown central migration: ${version}`);
  if (direction === "down" && entry.irreversible) throw new Error(`${version} is irreversible.`);
  if (!["up", "down"].includes(direction)) throw new Error(`Invalid migration direction: ${direction}`);
  const sourcePath = centralEntries.includes(entry) || entry === writerEntry || entry === reconciliationEntry || entry === prearchiveEntry || catalogReadEntries.includes(entry) || entry === centralImportEntry || entry === billingPdfEntry || entry === receiptEntry || entry === replayCapacityEntry || entry === failureCapacityEntry
    ? path.resolve(migrationsRoot, '../candidates', `${version.slice(4)}.${direction}.sql`)
    : path.join(migrationsRoot, `${version}.${direction}.sql`);
  const sourceSql = readSql(sourcePath);
  const policy = migrationChecksumPolicy(sourceSql, {
    acceptsHistoricalCrlfChecksum: direction === "up" && entry.acceptsHistoricalCrlfChecksum === true
  });
  const pinnedChecksum=direction==='up'?entry.upChecksum:entry.downChecksum;
  if(pinnedChecksum && policy.checksum!==pinnedChecksum)throw new Error(`Central migration ${version} ${direction} checksum mismatch.`);
  return {
    entry,
    ...policy
  };
}

function requiredCentralMigrations(entries = manifest) {
  return entries.map(entry => {
    const migration = migrationSql(entry.version, "up");
    return Object.freeze({
      version: entry.version,
      checksum: migration.checksum,
      acceptedChecksums: migration.acceptedChecksums,
      irreversible: entry.irreversible
    });
  });
}

function supportsCentralVersion(currentVersion, introducedVersion) {
  const branch = currentVersion === failureCapacityEntry.version ? failureCapacityManifest
    : currentVersion === replayCapacityEntry.version ? replayCapacityManifest
    : currentVersion === receiptEntry.version ? receiptManifest : knownManifest;
  const current = branch.findIndex(entry => entry.version === currentVersion);
  const introduced = branch.findIndex(entry => entry.version === introducedVersion);
  return current >= 0 && introduced >= 0 && current >= introduced;
}

function migrationRecordMatches(record, requirement) {
  return Boolean(record)
    && requirement.acceptedChecksums.includes(record.checksum_sha256)
    && record.irreversible === requirement.irreversible;
}

module.exports = {
  canonicalizeMigrationSql, checksumSql, manifest, registeredManifest, writerManifest, reconciliationManifest,
  knownManifest, receiptManifest, replayCapacityManifest, failureCapacityManifest, allKnownMigrations, centralImportManifest, catalogReadManifest, prearchiveManifest, migrationChecksumPolicy, migrationSql,
  migrationRecordMatches, requiredCentralMigrations, supportsCentralVersion
};
