const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: { isProxy } } = require('node:util');
const { assertNoTransactionControl } = require('./sqlTransactionControl');

const TENANT_BASELINE_VERSION = '000_tenant_control_baseline';
const TENANT_CATALOG_VERSION = 'tenant-read-only-bootstrap-v1';
const TENANT_BASELINE_CAPABILITIES = Object.freeze(['TENANT_CONTROL_BASELINE']);
const F9_CAPABILITIES = Object.freeze([...TENANT_BASELINE_CAPABILITIES, 'F9_ASYNC_EXECUTION']);
const F7_CAPABILITIES = Object.freeze([...F9_CAPABILITIES, 'F7_AUDIT_LEDGER']);
const F11_CAPABILITIES = Object.freeze([...F7_CAPABILITIES, 'F11_PRIVATE_DOCUMENT_STORAGE']);
const F12_CAPABILITIES = Object.freeze([
  ...F11_CAPABILITIES,
  'F12_PRIVATE_CATALOG_READ', 'F12_PRIVATE_CATALOG_WRITE', 'F12_DEDUPLICATION'
]);
const F9_LINEAGE_CAPABILITIES = Object.freeze([...F12_CAPABILITIES, 'F9_EXECUTION_LINEAGE']);
const F13_P1_CAPABILITIES = Object.freeze([...F9_LINEAGE_CAPABILITIES, 'F13_P1_ORGANIZATIONAL_SCOPE']);
const F13_PROFILE_CATALOG_CAPABILITIES = Object.freeze([
  ...F13_P1_CAPABILITIES, 'F13_PROFILE_CATALOG_FOUNDATION'
]);
const F13_AUTHORING_CAPABILITIES=Object.freeze([...F13_PROFILE_CATALOG_CAPABILITIES,'F13_PROFILE_AUTHORING']);
const migrationsRoot = path.resolve(__dirname, '../../database/tenant/migrations');
const TENANT_MIGRATION_RESERVATIONS=Object.freeze([Object.freeze({ordinal:13,version:'013_f13_constraints_and_epistemic_states',status:'RESERVED'})]);
const METADATA_TENANT_DOWNGRADE=Object.freeze({fromVersion:'014_f4_runtime_metadata_access',targetVersion:'012_f13_territories_and_populations',downChecksum:'6e91968cc279cfa787344285d3d9ad1191fba3690d23062bbad9644868a76937'});
// The sole supported downgrade is conservative and refuses any 007 data.
const SUPPORTED_TENANT_DOWNGRADE = Object.freeze({
  fromVersion: '007_f13_profile_catalogs_and_policies',
  targetVersion: '006_f13_p1_organizational_scope',
  downChecksum: '958ae2d8ef4153fe3387b82706d66edff55ddf76199f853f67397f6da1a33eca'
});
const COMPETENCY_TENANT_DOWNGRADE=Object.freeze({fromVersion:'009_f13_competencies_and_experience',
  targetVersion:'008_f13_profile_authoring_and_assertions',downChecksum:'f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7'});
const FINANCIAL_TENANT_DOWNGRADE=Object.freeze({fromVersion:'010_f13_financial_capacity',targetVersion:'009_f13_competencies_and_experience',downChecksum:'d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a'});
const OPERATIONAL_TENANT_DOWNGRADE=Object.freeze({fromVersion:'011_f13_operational_capacity',targetVersion:'010_f13_financial_capacity',downChecksum:'26e6cf72c5f166eaa496dc8dff9221f1fb859bb5a180e74d97a76b89f39b871b'});
const POPULATION_TENANT_DOWNGRADE=Object.freeze({fromVersion:'012_f13_territories_and_populations',targetVersion:'011_f13_operational_capacity',downChecksum:'1ff268c9a0b0502c93858ff14e5314fc8075f25e670b909d3732e610ab5b0396'});
const IMPORT_TENANT_DOWNGRADE=Object.freeze({fromVersion:'015_f12_opportunity_xlsx_import',targetVersion:'014_f4_runtime_metadata_access',downChecksum:'a9ea1f4389eccbe76ed94a8fdd98e8bedd92596d78ff18b93dc86dedef008f6b'});
const EDITORIAL_TENANT_DOWNGRADE=Object.freeze({fromVersion:'016_f13_editorial_baseline_publication',targetVersion:'015_f12_opportunity_xlsx_import',downChecksum:'b3ed12fac21708f16bdb8d66a23f9d08d2f301dd3b313125f46bb1b785e5b87c'});
const CRITERIA_TENANT_DOWNGRADE=Object.freeze({fromVersion:'017_opportunity_evidenced_criteria',targetVersion:'016_f13_editorial_baseline_publication',downChecksum:'d89e4d974dd5316f52e15b8abc280f1b8025434a64ea73797500c820aad84da4'});
const PQ1_TENANT_DOWNGRADE=Object.freeze({fromVersion:'018_f13_pq1_publication',targetVersion:'017_opportunity_evidenced_criteria',downChecksum:'525be4d1ddc34ea30c98cca90e1da43d24941b8151fad45113844d114aba9a75'});
const PQ1_ACTIVATION_TENANT_DOWNGRADE=Object.freeze({fromVersion:'019_f13_pq1_activation',targetVersion:'018_f13_pq1_publication',downChecksum:'98f4e350c51ac6a4667d048904d526a9cad70f2eb47e83d504a6eb3c1118546f'});
const PQ1_DECISION_TENANT_DOWNGRADE=Object.freeze({fromVersion:'020_f14_pq1_decisions',targetVersion:'019_f13_pq1_activation',downChecksum:'537ecfb747dd510e4ae4b04e9028e4fcd4dca580773cdfde2c229e51e3422b27'});
const APPLICATION_TENANT_DOWNGRADE=Object.freeze({fromVersion:'021_application_first_slice',targetVersion:'020_f14_pq1_decisions',downChecksum:'e96d8cd28e6e0881ce05b1851f2e1bff4e5895afbc285ffb34851535863a2dc7'});
const APPLICATION_WORK_TENANT_DOWNGRADE=Object.freeze({fromVersion:'022_application_team_tasks',targetVersion:'021_application_first_slice',downChecksum:'23a3405620320f0242e67b8a517b4189d583f0b7218ebc9069a4e53f7160b5d2'});
const APPLICATION_DOCUMENT_TENANT_DOWNGRADE=Object.freeze({fromVersion:'023_application_documents_review',targetVersion:'022_application_team_tasks',downChecksum:'9f5d8b4c84007543464608196cddb2b81d89d84b41d1f14859db9e6986e8c71d'});
const DOCUMENT_TRANSPORT_TENANT_DOWNGRADE=Object.freeze({fromVersion:'031_application_document_transport',targetVersion:'030_organization_notices',downChecksum:'57d30a42d5bd7f7401fb44fb27b57afd35a5a4de4d3b5a752c24d48a59595697'});
const DOCUMENT_WORKER_TENANT_DOWNGRADE=Object.freeze({fromVersion:'032_document_worker_runtime',targetVersion:'031_application_document_transport',downChecksum:'7a9f81c671d1af3fe8e6400018d91e51e67f0a97179700578c891450e7fbbc84'});
const LEGACY_SQL_CHECKSUMS = Object.freeze({
  '001_f9_async_execution': Object.freeze(['f8fe97640f3d2caa39e0e8bba98a0dc5d4c4b8c0c0ea6872de571a8ca5d61819'])
});

function compatibility(version) {
  return Object.freeze({ readVersions: Object.freeze([version]), writeVersions: Object.freeze([version]) });
}

const manifest = Object.freeze([
  Object.freeze({ version: TENANT_BASELINE_VERSION, ordinal: 0, irreversible: true,
    sqlChecksum: '29f5c43a25e3585cc9e9035f9bad10c9def104a65ae4701176cfd552ded5af75',
    schemaFingerprint: '8751cf659b63e683d9d3603a48b0a6f5ddbeb5a042bbeefc9656cf07e36d2a9b',
    capabilities: TENANT_BASELINE_CAPABILITIES, compatibility: compatibility(TENANT_BASELINE_VERSION) }),
  Object.freeze({ version: '001_f9_async_execution', ordinal: 1, irreversible: false,
    sqlChecksum: '8d84140152413da48579f8a8a0132be6a38b0b8b3761163a7caca80af6b9102a',
    schemaFingerprint: '2988704817125d4af4642880d8612b1509cb25ff998389232694dc08124097a6',
    capabilities: F9_CAPABILITIES, compatibility: compatibility('001_f9_async_execution') }),
  Object.freeze({ version: '002_f7_append_only_audit', ordinal: 2, irreversible: false,
    sqlChecksum: 'e8f6525bf4b69bc5c0c9a44f06b832c7ce979e1b72ac8b1b89ce475d5a6b62ff',
    schemaFingerprint: 'bc255bfd59012135c82188763aab27c428b6417661dde8349170e1eb40059ade',
    capabilities: F7_CAPABILITIES, compatibility: compatibility('002_f7_append_only_audit') }),
  Object.freeze({ version: '003_f11_private_document_storage', ordinal: 3, irreversible: false,
    sqlChecksum: 'f5e982129d57bd78728673ba10c2edd51e6d2fbc752c8f3da999281ba64d5075',
    schemaFingerprint: 'fce14fb1bfae7612b29dcc80b2cb56dc9f0d4c07aba3f2b4ffa651c8bc201e59',
    capabilities: F11_CAPABILITIES, compatibility: compatibility('003_f11_private_document_storage') }),
  Object.freeze({ version: '004_f12_opportunity_catalog', ordinal: 4, irreversible: false,
    sqlChecksum: 'e36a00d4d8ae05a5fe37fe91e32806a4aa4e67926a90f9d409e3ec89862a816b',
    schemaFingerprint: 'cd9456cd4956b16ee9317f6b9c4e32bccd790f6ee792fd00068d20c6e98fbf49',
    capabilities: F12_CAPABILITIES, compatibility: compatibility('004_f12_opportunity_catalog') }),
  Object.freeze({ version: '005_f9_execution_lineage', ordinal: 5, irreversible: false,
    sqlChecksum: 'dd4e4be2bb57c56361275146450448197db1bde32ee269931c8f11892a207991',
    schemaFingerprint: 'b9ade3a85f8326b305ae495c13e4ade1e293aaaf1fc9d638619c0a61c48acad1',
    capabilities: F9_LINEAGE_CAPABILITIES, compatibility: compatibility('005_f9_execution_lineage') }),
  Object.freeze({ version: '006_f13_p1_organizational_scope', ordinal: 6, irreversible: false,
    sqlChecksum: '841ca7033924af88eaf9448eccc7ff8984f880d759863487ef7a7699e7db1a65',
    schemaFingerprint: '25b4bc7825404dcb26967a2cd51d464547a11c66c5646a2f0823b389b5585644',
    capabilities: F13_P1_CAPABILITIES, compatibility: Object.freeze({
      readVersions: Object.freeze(['005_f9_execution_lineage','006_f13_p1_organizational_scope']),
      writeVersions: Object.freeze(['006_f13_p1_organizational_scope'])
    }) }),
  Object.freeze({ version: '007_f13_profile_catalogs_and_policies', ordinal: 7, irreversible: false,
    sqlChecksum: 'c327d759936b69df5f495e2454f209a6ddd34c94dc512933f700363a8cd5a900',
    schemaFingerprint: '8ea3cc86b1162d9bcd472314b457fc6d2c685fb68e7a783dbbb0ac1fc2ad66ad',
    capabilities: F13_PROFILE_CATALOG_CAPABILITIES, compatibility: Object.freeze({
      readVersions: Object.freeze(['006_f13_p1_organizational_scope','007_f13_profile_catalogs_and_policies']),
      writeVersions: Object.freeze(['007_f13_profile_catalogs_and_policies'])
    }) }),
  Object.freeze({version:'008_f13_profile_authoring_and_assertions',ordinal:8,irreversible:false,
    sqlChecksum:'7a6921546c6902bb59f6b3f34adbde4266e7eb947370cf0e7390b67b07edb30c',
    schemaFingerprint:'3330b61dd0cacee2d84b38b1a420b806a68c26007b8426b7bd8634a27f763cc0',
    capabilities:F13_AUTHORING_CAPABILITIES,compatibility:Object.freeze({
      readVersions:Object.freeze(['007_f13_profile_catalogs_and_policies','008_f13_profile_authoring_and_assertions']),
      writeVersions:Object.freeze(['008_f13_profile_authoring_and_assertions'])})}),
  Object.freeze({version:'009_f13_competencies_and_experience',ordinal:9,irreversible:false,
    sqlChecksum:'244282e6b87034d15600ab61df04a0fe77347c307132232509a300dbb184708e',
    schemaFingerprint:'b2e672669fd92f17fe9dc532d4eaa1148c1b350a9c3980910a4bc0d56596548e',
    capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE']),compatibility:Object.freeze({
      readVersions:Object.freeze(['008_f13_profile_authoring_and_assertions','009_f13_competencies_and_experience']),
      writeVersions:Object.freeze(['009_f13_competencies_and_experience'])})}),
  Object.freeze({version:'010_f13_financial_capacity',ordinal:10,irreversible:false,
    sqlChecksum:'ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93',schemaFingerprint:'638a93cad710bb8ac0f7755e9d80b436598d5f78bf7d85a411052968726cabd8',
    capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY']),compatibility:Object.freeze({
      readVersions:Object.freeze(['009_f13_competencies_and_experience','010_f13_financial_capacity']),writeVersions:Object.freeze(['010_f13_financial_capacity'])})}),
  Object.freeze({version:'011_f13_operational_capacity',ordinal:11,irreversible:false,
    sqlChecksum:'1f07a21b145d23500cd7928272ee0be816f90688e41a5ba5024566732d6cfdbd',schemaFingerprint:'281bf0340c7111a08a65833277e701a0e5452b95b1e1df21e1f9d7920a309444',
    capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY']),compatibility:Object.freeze({
      readVersions:Object.freeze(['010_f13_financial_capacity','011_f13_operational_capacity']),writeVersions:Object.freeze(['011_f13_operational_capacity'])})}),
  Object.freeze({version:'012_f13_territories_and_populations',ordinal:12,irreversible:false,sqlChecksum:'4f3972e42a292678b45e86d690aca7410155f17dee7fedfc275a88837c984cd8',schemaFingerprint:'b17e1dd05c73bdc4d65a5154abaafba8556c3cc6edbdefd9da4da28f9ee00dbd',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS']),compatibility:Object.freeze({readVersions:Object.freeze(['011_f13_operational_capacity','012_f13_territories_and_populations']),writeVersions:Object.freeze(['012_f13_territories_and_populations'])})})
  ,Object.freeze({version:'014_f4_runtime_metadata_access',ordinal:14,irreversible:false,sqlChecksum:'5051cc10b19d034d30969ab63f1aa9275716b4e51da3eb866b6e7fd09d8ee7d1',schemaFingerprint:'5da1ec459a7f6ef70a9fd583b31a44e048c5fd7f18e8c475d203413ab3ead441',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS']),compatibility:compatibility('014_f4_runtime_metadata_access')})
  ,Object.freeze({version:'015_f12_opportunity_xlsx_import',ordinal:15,irreversible:false,sqlChecksum:'58ecebd8c4dd726bd7f65d4ec16adebab44bc3a838ca8177ef486e983c7ba509',schemaFingerprint:'9f9a055b754d98335169b534c938f4b8225f01345bcd88c5548ca9160c6cfd74',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT']),compatibility:compatibility('015_f12_opportunity_xlsx_import')}),Object.freeze({version:'016_f13_editorial_baseline_publication',ordinal:16,irreversible:false,sqlChecksum:'18365bce636ff77a257b55724545711db33b12520d6b34e0f613c1a256b6331d',schemaFingerprint:'31233d0b9974048d40e3695932e13b3b50c637d6ab92d3b52d7e27fe12599859',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION']),compatibility:compatibility('016_f13_editorial_baseline_publication')}),
Object.freeze({version:'017_opportunity_evidenced_criteria',ordinal:17,irreversible:false,sqlChecksum:'352440c3843e4b033cb208ac0aaa04eea82e3c0038f72cdf805b7c51982b6b77',schemaFingerprint:'8cec1cbad740381ae722d9ec4c481371c30892ffefdc9b9f5a5ff4fa38e8729d',capabilities:Object.freeze(["TENANT_CONTROL_BASELINE","F9_ASYNC_EXECUTION","F7_AUDIT_LEDGER","F11_PRIVATE_DOCUMENT_STORAGE","F12_PRIVATE_CATALOG_READ","F12_PRIVATE_CATALOG_WRITE","F12_DEDUPLICATION","F9_EXECUTION_LINEAGE","F13_P1_ORGANIZATIONAL_SCOPE","F13_PROFILE_CATALOG_FOUNDATION","F13_PROFILE_AUTHORING","F13_COMPETENCIES_AND_EXPERIENCE","F13_FINANCIAL_CAPACITY","F13_OPERATIONAL_CAPACITY","F13_TERRITORIES_AND_POPULATIONS","F4_RUNTIME_METADATA_ACCESS","F12_OPPORTUNITY_XLSX_IMPORT","F13_EDITORIAL_BASELINE_PUBLICATION","OPPORTUNITY_EVIDENCED_CRITERIA"]),compatibility:compatibility('017_opportunity_evidenced_criteria')})
  ,Object.freeze({version:'018_f13_pq1_publication',ordinal:18,irreversible:false,sqlChecksum:'553692a662c4fc316ececf33ea18308dbbb73ff6e485585b4f72cd95e64c8626',schemaFingerprint:'e21b6fefe6eb829158eaa727aa51885d153cdededb18b7bdc392dfac4b0ac730',capabilities:Object.freeze(["TENANT_CONTROL_BASELINE","F9_ASYNC_EXECUTION","F7_AUDIT_LEDGER","F11_PRIVATE_DOCUMENT_STORAGE","F12_PRIVATE_CATALOG_READ","F12_PRIVATE_CATALOG_WRITE","F12_DEDUPLICATION","F9_EXECUTION_LINEAGE","F13_P1_ORGANIZATIONAL_SCOPE","F13_PROFILE_CATALOG_FOUNDATION","F13_PROFILE_AUTHORING","F13_COMPETENCIES_AND_EXPERIENCE","F13_FINANCIAL_CAPACITY","F13_OPERATIONAL_CAPACITY","F13_TERRITORIES_AND_POPULATIONS","F4_RUNTIME_METADATA_ACCESS","F12_OPPORTUNITY_XLSX_IMPORT","F13_EDITORIAL_BASELINE_PUBLICATION","OPPORTUNITY_EVIDENCED_CRITERIA","F13_PQ1_PUBLICATION"]),compatibility:compatibility('018_f13_pq1_publication')}),Object.freeze({version:'019_f13_pq1_activation',ordinal:19,irreversible:false,sqlChecksum:'d84ceb78cda7e600bc5c79109f4c021588e6115c636337a3c6580e782e169aeb',schemaFingerprint:'41a0c375bcb29601167f2788efbb8434055be5c4ab5e310152cbf665e26c0eb9',capabilities:Object.freeze(["TENANT_CONTROL_BASELINE", "F9_ASYNC_EXECUTION", "F7_AUDIT_LEDGER", "F11_PRIVATE_DOCUMENT_STORAGE", "F12_PRIVATE_CATALOG_READ", "F12_PRIVATE_CATALOG_WRITE", "F12_DEDUPLICATION", "F9_EXECUTION_LINEAGE", "F13_P1_ORGANIZATIONAL_SCOPE", "F13_PROFILE_CATALOG_FOUNDATION", "F13_PROFILE_AUTHORING", "F13_COMPETENCIES_AND_EXPERIENCE", "F13_FINANCIAL_CAPACITY", "F13_OPERATIONAL_CAPACITY", "F13_TERRITORIES_AND_POPULATIONS", "F4_RUNTIME_METADATA_ACCESS", "F12_OPPORTUNITY_XLSX_IMPORT", "F13_EDITORIAL_BASELINE_PUBLICATION", "OPPORTUNITY_EVIDENCED_CRITERIA", "F13_PQ1_PUBLICATION", "F13_PQ1_ACTIVATION", "F14_PQ1_CONSUMPTION"]),compatibility:compatibility('019_f13_pq1_activation')}),Object.freeze({version:'020_f14_pq1_decisions',ordinal:20,irreversible:false,sqlChecksum:'1b8877f8a3cb6343dc7b3735ecccc3c0da60d9c062662723abb76646630d100f',schemaFingerprint:'c3b5d77d296718de27bc346863da3d004125aedf0b73de57e37334b804b0bd19',capabilities:Object.freeze(["TENANT_CONTROL_BASELINE", "F9_ASYNC_EXECUTION", "F7_AUDIT_LEDGER", "F11_PRIVATE_DOCUMENT_STORAGE", "F12_PRIVATE_CATALOG_READ", "F12_PRIVATE_CATALOG_WRITE", "F12_DEDUPLICATION", "F9_EXECUTION_LINEAGE", "F13_P1_ORGANIZATIONAL_SCOPE", "F13_PROFILE_CATALOG_FOUNDATION", "F13_PROFILE_AUTHORING", "F13_COMPETENCIES_AND_EXPERIENCE", "F13_FINANCIAL_CAPACITY", "F13_OPERATIONAL_CAPACITY", "F13_TERRITORIES_AND_POPULATIONS", "F4_RUNTIME_METADATA_ACCESS", "F12_OPPORTUNITY_XLSX_IMPORT", "F13_EDITORIAL_BASELINE_PUBLICATION", "OPPORTUNITY_EVIDENCED_CRITERIA", "F13_PQ1_PUBLICATION", "F13_PQ1_ACTIVATION", "F14_PQ1_CONSUMPTION", "F14_PQ1_DECISIONS"]),compatibility:compatibility('020_f14_pq1_decisions')}),Object.freeze({version:'021_application_first_slice',ordinal:21,irreversible:false,sqlChecksum:'7f656827ec4262cdb7f056a6d4962c6c10e62444861b134ead524c5e6b3abc47',schemaFingerprint:'96bfba6b3cb786da283cd88184a469c8167c8d72af20350b68b97f960e6b41f3',capabilities:Object.freeze(["TENANT_CONTROL_BASELINE", "F9_ASYNC_EXECUTION", "F7_AUDIT_LEDGER", "F11_PRIVATE_DOCUMENT_STORAGE", "F12_PRIVATE_CATALOG_READ", "F12_PRIVATE_CATALOG_WRITE", "F12_DEDUPLICATION", "F9_EXECUTION_LINEAGE", "F13_P1_ORGANIZATIONAL_SCOPE", "F13_PROFILE_CATALOG_FOUNDATION", "F13_PROFILE_AUTHORING", "F13_COMPETENCIES_AND_EXPERIENCE", "F13_FINANCIAL_CAPACITY", "F13_OPERATIONAL_CAPACITY", "F13_TERRITORIES_AND_POPULATIONS", "F4_RUNTIME_METADATA_ACCESS", "F12_OPPORTUNITY_XLSX_IMPORT", "F13_EDITORIAL_BASELINE_PUBLICATION", "OPPORTUNITY_EVIDENCED_CRITERIA", "F13_PQ1_PUBLICATION", "F13_PQ1_ACTIVATION", "F14_PQ1_CONSUMPTION", "F14_PQ1_DECISIONS", "APPLICATION_FIRST_SLICE"]),compatibility:compatibility('021_application_first_slice')}),
  Object.freeze({version:'022_application_team_tasks',ordinal:22,irreversible:false,sqlChecksum:'ce24cf9f558a776a84a1bf9d295c8bf8844cae1ab4055b5bea96dac22590c7ac',schemaFingerprint:'61369b114760234ec6fe453bfbf9a982c866e1255587c7310d2405b2e1be93d9',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS']),compatibility:compatibility('022_application_team_tasks')}),
  Object.freeze({version:'023_application_documents_review',ordinal:23,irreversible:false,sqlChecksum:'e89ab596933767c5ae0ec579eebe026470d8b503028b3ba9145350add555798a',schemaFingerprint:'3931dffc3c319409b5636c963dcd137543405d7dbdac1cbd50fe20ffc63bccee',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW']),compatibility:compatibility('023_application_documents_review')}),
  Object.freeze({version:'024_application_central_origin',ordinal:24,irreversible:true,sqlChecksum:'3373df5275626ec338d77053700e11c103c62b252fa340bf06ed3bbc5dc6d92e',schemaFingerprint:'cea234386c8ed05526bf4b4affac4b7d83992fbf0731661b0225d4532abe538d',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN']),compatibility:compatibility('024_application_central_origin')})
  ,Object.freeze({version:'025_organization_directory',ordinal:25,irreversible:true,sqlChecksum:'f2b60f88e58d25f7e947d7d5489452ac1f3a985fb9612760405ab2550cd5d069',schemaFingerprint:'cc40d2a5e6b597b5e7e5707d680b0c480b22af202117a870462f7bf56a68b4ba',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY']),compatibility:compatibility('025_organization_directory')})
  ,Object.freeze({version:'026_personal_profile',ordinal:26,irreversible:true,sqlChecksum:'fd6fd91659efe186ea51451dd39ad2d69c7b913e3ce06510d95215870ccf1615',schemaFingerprint:'243c339bff099521b7852176b4fa6870fc0a888a5c41094ff5082f9aa7290321',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE']),compatibility:compatibility('026_personal_profile')})
  ,Object.freeze({version:'027_application_lifecycle',ordinal:27,irreversible:true,sqlChecksum:'dc51c7c65d563532ce891d62485a2913e240eb9d708becbe3d4c672ca09ca388',schemaFingerprint:'797275c2830f68ada3105c148f7fd3d496b47554b5d6579ac725f5504128fbed',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE']),compatibility:compatibility('027_application_lifecycle')})
  ,Object.freeze({version:'028_application_partners',ordinal:28,irreversible:true,sqlChecksum:'9a403e433ebcab39574d43d882d83d09b2a3b762bab45ec38fa11969ffbdfb27',schemaFingerprint:'5ebd79bcbda05ec86874242559e89a472cecf377db07558ce7d6416d66e03c17',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS']),compatibility:compatibility('028_application_partners')})
  ,Object.freeze({version:'029_application_alerts',ordinal:29,irreversible:true,sqlChecksum:'3a4c741b7acfae929fc32d1668a472d54fcac8aa6181e7bad4f0a598bea358b9',schemaFingerprint:'6c3ab4b0b1ebc3a9552a4b5096e05d2cdc4ebae1ea78b5f9407092abf8bcb617',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS','APPLICATION_ALERTS']),compatibility:compatibility('029_application_alerts')})
  ,Object.freeze({version:'030_organization_notices',ordinal:30,irreversible:true,sqlChecksum:'25a407d1926d08d44f2fbe692040a748b5c39e92f51ffac0723015ee7c51f2c1',schemaFingerprint:'518daabb394601fe785442c80ea83349135908c1331c60fe9f59e56683dd5712',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS','APPLICATION_ALERTS','ORGANIZATION_NOTICES']),compatibility:compatibility('030_organization_notices')})
  ,Object.freeze({version:'031_application_document_transport',ordinal:31,irreversible:false,sqlChecksum:'a9b5cb8b8f1f097c6790c75e0edba77634b6017c899ff6cfd7178196197ad02f',schemaFingerprint:'11b8e09294f53d4acffc9a8be25075930554efb30f429e9df25c28edcada9674',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS','APPLICATION_ALERTS','ORGANIZATION_NOTICES','APPLICATION_DOCUMENT_TRANSPORT']),compatibility:compatibility('031_application_document_transport')})
  ,Object.freeze({version:'032_document_worker_runtime',ordinal:32,irreversible:false,sqlChecksum:'e44c16134ae240471e99bce6bb1ebd8c74953ebfeb0ff73ef0927d454ffc1552',schemaFingerprint:'d435b5ce9b19002ba195e37a8509b6ff7be9266a3b8c31073ca00e205c4167ac',capabilities:Object.freeze([...F13_AUTHORING_CAPABILITIES,'F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS','APPLICATION_ALERTS','ORGANIZATION_NOTICES','APPLICATION_DOCUMENT_TRANSPORT','DOCUMENT_WORKER_RUNTIME']),compatibility:compatibility('032_document_worker_runtime')})
  ,Object.freeze({"version":"033_organizational_opportunity_interests","ordinal":33,"irreversible":true,"sqlChecksum":"62f725ea391fc75a3f49bc7ddd886347cbdb7efc5c0a992e3a85ffc57cc4b0ed","schemaFingerprint":"d3526c7287fade9a1009ce223be8d36769c38b9345f89e9c72180cb940c793bc",capabilities:Object.freeze(["TENANT_CONTROL_BASELINE","F9_ASYNC_EXECUTION","F7_AUDIT_LEDGER","F11_PRIVATE_DOCUMENT_STORAGE","F12_PRIVATE_CATALOG_READ","F12_PRIVATE_CATALOG_WRITE","F12_DEDUPLICATION","F9_EXECUTION_LINEAGE","F13_P1_ORGANIZATIONAL_SCOPE","F13_PROFILE_CATALOG_FOUNDATION","F13_PROFILE_AUTHORING","F13_COMPETENCIES_AND_EXPERIENCE","F13_FINANCIAL_CAPACITY","F13_OPERATIONAL_CAPACITY","F13_TERRITORIES_AND_POPULATIONS","F4_RUNTIME_METADATA_ACCESS","F12_OPPORTUNITY_XLSX_IMPORT","F13_EDITORIAL_BASELINE_PUBLICATION","OPPORTUNITY_EVIDENCED_CRITERIA","F13_PQ1_PUBLICATION","F13_PQ1_ACTIVATION","F14_PQ1_CONSUMPTION","F14_PQ1_DECISIONS","APPLICATION_FIRST_SLICE","APPLICATION_TEAM_TASKS","APPLICATION_DOCUMENT_REVIEW","APPLICATION_CENTRAL_ORIGIN","ORGANIZATION_DIRECTORY","PERSONAL_PROFILE","APPLICATION_LIFECYCLE","APPLICATION_PARTNERS","APPLICATION_ALERTS","ORGANIZATION_NOTICES","APPLICATION_DOCUMENT_TRANSPORT","DOCUMENT_WORKER_RUNTIME","ORGANIZATIONAL_OPPORTUNITY_INTERESTS"]),compatibility:compatibility("033_organizational_opportunity_interests")})
]);

const { tenantAddition, TENANT_CAPABILITY } = require('./opportunityV2MigrationPackage');
const registeredManifest = Object.freeze([...manifest, Object.freeze({
  ...tenantAddition,
  capabilities: Object.freeze([...manifest.at(-1).capabilities, TENANT_CAPABILITY]),
  compatibility: compatibility(tenantAddition.version)
})]);
const receiptEntry = Object.freeze({
  version: '034_f12_service_receipt', ordinal: 34, irreversible: true,
  sqlChecksum: 'de368f842473da2c38ca5988e2bf51f3ea53c48b84e0bdb46e41ff3355a78945',
  schemaFingerprint: '90520b9b1d28dedec9573f297d3344b8e658b8de2497af6c2e885402976390fc',
  capabilities: Object.freeze([...manifest.at(-1).capabilities, 'F12_SERVICE_RECEIPTS']),
  compatibility: compatibility('034_f12_service_receipt')
});
const receiptManifest = Object.freeze([...manifest, receiptEntry]);
const failureReceiptEntry = Object.freeze({
  ...receiptEntry, version: '035_f12_replay_failure_receipt', ordinal: 35,
  sqlChecksum: 'edce54abc5823643cfd74a108ad954d5cae2470ca7f48466b4836ec2ac16a422',
  schemaFingerprint: '4638e6622be702575a2e1b46c066cd99aa1a077586fbc60942f22931718daa36',
  capabilities: Object.freeze([...receiptEntry.capabilities, 'F12_REPLAY_FAILURE_RECEIPT']),
  compatibility: compatibility('035_f12_replay_failure_receipt')
});
const failureReceiptManifest = Object.freeze([...receiptManifest, failureReceiptEntry]);
const assignedReviewEntry = Object.freeze({
  version: '035_application_review_assignments', ordinal: 35, irreversible: true,
  sqlChecksum: '9664ff1158ef075d9dbb1fe1e8b4b4cc86eeb3862aa291fa0d66cdd9a5d0f35e',
  schemaFingerprint: '73eeffb95a170529e5d6853c21600e39a1e81959277ddd8fd59bc26e1ee3f0e6',
  capabilities: Object.freeze([...registeredManifest.at(-1).capabilities, 'APPLICATION_REVIEW_ASSIGNMENTS']),
  compatibility: compatibility('035_application_review_assignments')
});
const assignedReviewManifest = Object.freeze([...registeredManifest, assignedReviewEntry]);
const APPLICATION_CHAT_SCHEMA_VERSION = '036_application_team_chat';
const applicationChatEntry = Object.freeze({
  version: APPLICATION_CHAT_SCHEMA_VERSION, ordinal: 36, irreversible: true,
  sqlChecksum: '341d47726255843a05fff33211087524e03b6e089fc86e16ea6336389202f90f',
  schemaFingerprint: 'f3d897671b4321c160b9671a1acd7d5fbbddbc99d568eea244b5b08ab5c25e65',
  capabilities: Object.freeze([...assignedReviewEntry.capabilities, 'APPLICATION_TEAM_CHAT']),
  compatibility: compatibility(APPLICATION_CHAT_SCHEMA_VERSION)
});
const applicationChatManifest = Object.freeze([...assignedReviewManifest, applicationChatEntry]);
const ORGANIZATION_STRATEGY_SCHEMA_VERSION = '037_organization_strategy';
const organizationStrategyEntry = Object.freeze({
  version: ORGANIZATION_STRATEGY_SCHEMA_VERSION, ordinal: 37, irreversible: true,
  sqlChecksum: 'ee7d7a00d84e822f498044e2cbbe732d2be150ae1d32a3581006b0f51d46b912',
  schemaFingerprint: '697f1aebaab1d417bafb2ee5624c1337d3ef3f572ac539ed089fe831e585f2cb',
  capabilities: Object.freeze([...applicationChatEntry.capabilities, 'ORGANIZATION_STRATEGY']),
  compatibility: compatibility(ORGANIZATION_STRATEGY_SCHEMA_VERSION)
});
const organizationStrategyManifest = Object.freeze([...applicationChatManifest, organizationStrategyEntry]);
const APPLICATION_TASK_DETAILS_SCHEMA_VERSION = '038_application_task_details';
const applicationTaskDetailsEntry = Object.freeze({
  version: APPLICATION_TASK_DETAILS_SCHEMA_VERSION, ordinal: 38, irreversible: true,
  sqlChecksum: '8a0300680fc87fd471192ab39f0ee5787efba5da20c275e7b56d009978df1085',
  schemaFingerprint: '3a36c82ecb961d06b06226741c749021e8e61f494590cfaef56a3a96c60d17ef',
  capabilities: Object.freeze([...organizationStrategyEntry.capabilities, 'APPLICATION_TASK_DETAILS']),
  compatibility: compatibility(APPLICATION_TASK_DETAILS_SCHEMA_VERSION)
});
const applicationTaskDetailsManifest = Object.freeze([...organizationStrategyManifest, applicationTaskDetailsEntry]);
const DOCUMENT_DELETION_SCHEMA_VERSION = '039_document_deletion';
const documentDeletionEntry = Object.freeze({
  version: DOCUMENT_DELETION_SCHEMA_VERSION, ordinal: 39, irreversible: true,
  sqlChecksum: '56c85d8743c2843a8d3852d4311953ed343b4a31f914f1cc4862b6ac10cb4f38',
  schemaFingerprint: '45842789b0f1eb7844f5c36085a76d3782f7a6c7f15c3cfeff97fbcf6f254dcc',
  capabilities: Object.freeze([...applicationTaskDetailsEntry.capabilities, 'DOCUMENT_DELETION']),
  compatibility: compatibility(DOCUMENT_DELETION_SCHEMA_VERSION)
});
const documentDeletionManifest = Object.freeze([...applicationTaskDetailsManifest, documentDeletionEntry]);
const allRegisteredMigrations = Object.freeze([...documentDeletionManifest, receiptEntry, failureReceiptEntry]);

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalizeTenantMigrationSql(sql) {
  if (typeof sql !== 'string') throw new TypeError('Tenant migration SQL must be UTF-8 text.');
  if (sql.charCodeAt(0) === 0xfeff) throw new TypeError('Tenant migration SQL must not contain a BOM.');
  return sql.replace(/\r\n/g, '\n');
}

function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function assertRunnerControlled(sql) {
  assertNoTransactionControl(sql, 'Tenant migration transaction control belongs to the runner.');
}

// Migration sources are immutable release artefacts. Runtime preflights call
// this for every lease; re-reading, hashing and scanning the same files only
// spent CPU on the API thread. The database ledger and schema are still read
// fresh by each caller. Injected readers and loaders are never cached.
const readMigrationFile = file => fs.readFileSync(file, 'utf8');
const loadedMigrationSql = new Map();
function migrationSql(version, direction, readSql = readMigrationFile) {
  if (readSql !== readMigrationFile) return sourceMigrationSql(version, direction, readSql);
  const key = `${version}
${direction}`;
  let loaded = loadedMigrationSql.get(key);
  if (!loaded) { loaded = sourceMigrationSql(version, direction, readSql); loadedMigrationSql.set(key, loaded); }
  return loaded;
}

function sourceMigrationSql(version, direction, readSql) {
  const entry = allRegisteredMigrations.find(item => item.version === version);
  if (!entry) throw new TypeError('Tenant migration is not registered.');
  if (!['up', 'down'].includes(direction)) throw new TypeError('Tenant migration direction is invalid.');
  if (direction === 'down' && entry.irreversible) throw new TypeError('Tenant migration is irreversible.');
  const sourcePath = entry === failureReceiptEntry ? path.resolve(migrationsRoot, '../provisioning/f12_replay_failure_receipt.sql') : entry === receiptEntry
    ? path.resolve(migrationsRoot, '../candidates/f12_service_receipt.up.sql')
    : version === tenantAddition.version
    ? path.resolve(migrationsRoot, '../candidates/application_snapshot_v2.up.sql')
    : path.join(migrationsRoot, `${version}.${direction}.sql`);
  const sql = canonicalizeTenantMigrationSql(readSql(sourcePath));
  const checksum = checksumSql(sql);
  if ((entry === failureReceiptEntry || entry === receiptEntry || entry === assignedReviewEntry || entry === applicationChatEntry || entry === organizationStrategyEntry || entry === documentDeletionEntry || version === tenantAddition.version) && checksum !== entry.sqlChecksum) throw new TypeError('Tenant migration checksum mismatch.');
  return Object.freeze({ entry, sql, checksum });
}

function validateCompatibility(contract, versions) {
  if (!plainRecord(contract) || !Object.isFrozen(contract)
      || Reflect.ownKeys(contract).length !== 2
      || !Array.isArray(contract.readVersions) || !Object.isFrozen(contract.readVersions)
      || !Array.isArray(contract.writeVersions) || !Object.isFrozen(contract.writeVersions)) {
    throw new TypeError('Tenant compatibility contract is invalid.');
  }
  for (const list of [contract.readVersions, contract.writeVersions]) {
    if (list.length === 0 || new Set(list).size !== list.length || list.some(version => !versions.has(version))) {
      throw new TypeError('Tenant compatibility versions are invalid.');
    }
  }
}

function validateTenantMigrationManifest(entries = manifest, loadMigration = migrationSql, reservations = TENANT_MIGRATION_RESERVATIONS) {
  if (!Array.isArray(entries) || !Object.isFrozen(entries) || entries.length === 0) {
    throw new TypeError('Tenant migration manifest must be a frozen non-empty array.');
  }
  const versions = new Set(entries.map(entry => entry && entry.version));
  const fingerprints = new Set();
  entries.forEach((entry, index) => {
    const expectedKeys = [
      'version', 'ordinal', 'irreversible', 'sqlChecksum', 'schemaFingerprint', 'capabilities', 'compatibility'
    ];
    if (!plainRecord(entry) || !Object.isFrozen(entry)
        || Reflect.ownKeys(entry).length !== expectedKeys.length
        || expectedKeys.some(key => !Object.prototype.hasOwnProperty.call(entry, key))
        || entry.ordinal !== Number(entry.version?.slice(0,3)) || !/^[0-9]{3}_[a-z0-9_]+$/.test(entry.version)
        || entries.findIndex(item => item.version === entry.version) !== index
        || typeof entry.irreversible !== 'boolean'
        || !/^[a-f0-9]{64}$/.test(entry.sqlChecksum)
        || !/^[a-f0-9]{64}$/.test(entry.schemaFingerprint)
        || fingerprints.has(entry.schemaFingerprint)
        || !Array.isArray(entry.capabilities) || !Object.isFrozen(entry.capabilities)
        || entry.capabilities.length === 0 || new Set(entry.capabilities).size !== entry.capabilities.length
        || entry.capabilities.some(code => !/^[A-Z][A-Z0-9_]{0,63}$/.test(code))) {
      throw new TypeError('Tenant migration manifest entry is invalid.');
    }
    fingerprints.add(entry.schemaFingerprint);
    const previous=index?entries[index-1].ordinal:-1;
    for(let ordinal=previous+1;ordinal<entry.ordinal;ordinal++){
      if(!reservations.some(reservation=>reservation.ordinal===ordinal&&reservation.status==='RESERVED'&&Number(reservation.version?.slice(0,3))===ordinal))
        throw new TypeError('Tenant migration gap is not explicitly reserved.');
    }
    if(reservations.some(reservation=>reservation.ordinal===entry.ordinal))throw new TypeError('Reserved tenant migration cannot be applied.');
    validateCompatibility(entry.compatibility, versions);
    const migration = loadMigration(entry.version, 'up');
    if (!migration || migration.entry.version !== entry.version || migration.checksum !== entry.sqlChecksum) {
      throw new TypeError('Tenant migration source is invalid.');
    }
    assertRunnerControlled(migration.sql);
    if (!entry.irreversible) assertRunnerControlled(loadMigration(entry.version, 'down').sql);
  });
  return true;
}

const requiredByManifest = new WeakMap();
function requiredTenantMigrations(entries = manifest, loadMigration = migrationSql) {
  // Frozen manifests validated against the built-in sources cannot change
  // within the process; custom loaders are always validated again.
  if (loadMigration !== migrationSql || !Object.isFrozen(entries)) return computeRequiredTenantMigrations(entries, loadMigration);
  let required = requiredByManifest.get(entries);
  if (!required) { required = computeRequiredTenantMigrations(entries, loadMigration); requiredByManifest.set(entries, required); }
  return required;
}

function computeRequiredTenantMigrations(entries, loadMigration) {
  validateTenantMigrationManifest(entries, loadMigration);
  return Object.freeze(entries.map(entry => {
    loadMigration(entry.version, 'up');
    return Object.freeze({
      migrationId: entry.version,
      ordinal: entry.ordinal,
      checksum: entry.sqlChecksum,
      irreversible: entry.irreversible,
      resultingFingerprint: entry.schemaFingerprint
    });
  }));
}

function validateTenantLedger(rows, entries, loadMigration = migrationSql) {
  if (!Array.isArray(rows)) throw new TypeError('Tenant migration ledger is invalid.');
  const head = rows.at(-1)?.migration_id;
  entries ??= [applicationTaskDetailsManifest, organizationStrategyManifest, applicationChatManifest, assignedReviewManifest, failureReceiptManifest, receiptManifest]
    .find(candidate => candidate.at(-1).version === head) || registeredManifest;
  const required = requiredTenantMigrations(entries, loadMigration);
  // An exact historical execution record may coexist with a repaired canonical
  // schema. Never rewrite it; preflight independently verifies the actual schema.
  const historicalPrefixLength = 30;
  const historicalOwnership = rows.length >= historicalPrefixLength && entries.length >= historicalPrefixLength
    && entries.slice(0,historicalPrefixLength).every((entry,index)=>entry === manifest[index])
    && require('./tenantHistoricalOwnership').isHistoricalOwnershipLedger(rows.slice(0,historicalPrefixLength));
  if (rows.length > required.length) throw new TypeError('Tenant migration ledger contains an unknown version.');
  rows.forEach((row, index) => {
    const expected = required[index];
    const acceptedChecksums = [expected.checksum, ...(LEGACY_SQL_CHECKSUMS[expected.migrationId] || [])];
    if (!row || row.migration_id !== expected.migrationId || Number(row.ordinal) !== expected.ordinal
        || !acceptedChecksums.includes(row.checksum_sha256) || row.irreversible !== expected.irreversible
        || (!(historicalOwnership && index < historicalPrefixLength) && row.resulting_fingerprint !== expected.resultingFingerprint)) {
      throw new TypeError('Tenant migration ledger differs from the manifest.');
    }
  });
  return Object.freeze({
    currentVersion: rows.length ? rows.at(-1).migration_id : null,
    appliedVersions: Object.freeze(rows.map(row => row.migration_id))
  });
}

validateTenantMigrationManifest();
validateTenantMigrationManifest(registeredManifest);
validateTenantMigrationManifest(receiptManifest);
validateTenantMigrationManifest(failureReceiptManifest);
validateTenantMigrationManifest(applicationChatManifest);
validateTenantMigrationManifest(organizationStrategyManifest);
validateTenantMigrationManifest(applicationTaskDetailsManifest);
validateTenantMigrationManifest(documentDeletionManifest);

module.exports = {
  APPLICATION_TENANT_DOWNGRADE,
  APPLICATION_WORK_TENANT_DOWNGRADE,
  APPLICATION_DOCUMENT_TENANT_DOWNGRADE,
  DOCUMENT_TRANSPORT_TENANT_DOWNGRADE,
  DOCUMENT_WORKER_TENANT_DOWNGRADE,
  PQ1_DECISION_TENANT_DOWNGRADE,
  TENANT_MIGRATION_RESERVATIONS,
  METADATA_TENANT_DOWNGRADE,
  SUPPORTED_TENANT_DOWNGRADE,
  COMPETENCY_TENANT_DOWNGRADE,
  FINANCIAL_TENANT_DOWNGRADE,
  OPERATIONAL_TENANT_DOWNGRADE,
  POPULATION_TENANT_DOWNGRADE,
  IMPORT_TENANT_DOWNGRADE,
  EDITORIAL_TENANT_DOWNGRADE,
  CRITERIA_TENANT_DOWNGRADE,
  PQ1_TENANT_DOWNGRADE,
  PQ1_ACTIVATION_TENANT_DOWNGRADE,
  TENANT_BASELINE_CAPABILITIES,
  F12_CAPABILITIES,
  F9_LINEAGE_CAPABILITIES,
  F13_P1_CAPABILITIES,
  F13_PROFILE_CATALOG_CAPABILITIES,
  F13_AUTHORING_CAPABILITIES,
  TENANT_BASELINE_VERSION,
  TENANT_CATALOG_VERSION,
  canonicalizeTenantMigrationSql,
  checksumSql,
  manifest,
  registeredManifest,
  receiptManifest, failureReceiptManifest, assignedReviewManifest, applicationChatManifest, APPLICATION_CHAT_SCHEMA_VERSION,
  organizationStrategyManifest, ORGANIZATION_STRATEGY_SCHEMA_VERSION,
  applicationTaskDetailsManifest, APPLICATION_TASK_DETAILS_SCHEMA_VERSION,
  documentDeletionManifest, DOCUMENT_DELETION_SCHEMA_VERSION,
  allRegisteredMigrations,
  migrationSql,
  requiredTenantMigrations,
  validateTenantLedger,
  validateTenantMigrationManifest
};
