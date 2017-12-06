// Run Case, Opportunity, Solution, Lead, Contact, Solution, Report, Account
const jsforce = require('jsforce');
const fs = require('fs');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
  { name: 'profile-name', type: String, defaultOption: true },
  { name: 'username-retrieve', type: String },
  { name: 'username-deploy', type: String },
  { name: 'password-retrieve', type: String },
  { name: 'password-deploy', type: String },
  { name: 'retrieve-login-url', type: String, defaultValue: 'https://test.salesforce.com' },
  { name: 'deploy-login-url', type: String, defaultValue: 'https://test.salesforce.com' },
];
const options = commandLineArgs(optionDefinitions);

const username_retrieve = options['username-retrieve'];
const password_retrieve = options['password-retrieve'];
const username_deploy = options['username-deploy'];
const password_deploy = options['password-deploy'];
const fullNames = [options['profile-name']];

const conn = new jsforce.Connection({
  // you can change loginUrl to connect to sandbox or prerelease env.
  loginUrl: options['deploy-login-url'],
});
const conndeploy = new jsforce.Connection({
  // you can change loginUrl to connect to sandbox or prerelease env.
  loginUrl: options['retrieve-login-url'],
});

let metadata;
let results;
async function sfConnect(username, password, connection) {
  await connection.login(username, password, (err, res) => {
    if (err) {
      console.log(err);
    }
    //  console.log(conn.accessToken);
    //  console.log(conn.instanceUrl);
    //  console.log(`User ID: ${res.id}`);
    //  console.log(`Org ID: ${res.organizationId}`);
  });
  console.log(`System Logged in succesfully with user: ${username}`);
}

async function sfRetrieve(connection) {
  metadata = await connection.metadata.read('Profile', fullNames, (err, metadata) => {
    if (err) {
      console.log(err);
    }
  });
}

async function sfdeploy(connection, meta) {


  await connection.metadata.upsert('Profile', meta, (err, results) => {
    if (err) { console.error(err); }


    if (!results.success) {
      // console.log(results.errors);
      if (Object.prototype.toString.call(results.errors) === '[object Object]') {
        results.errors = [results.errors];
      }
      const test_array = [];
      // console.log(results);

      results.errors.forEach((element) => {
        if (element.statusCode == 'FIELD_INTEGRITY_EXCEPTION') {
          //  console.log(element);
          const mesa = element.message.split(':');
          mesa[1].split(',').forEach((value) => {
            value = value.replace(/ /g, '');
            // console.log(value);

            if (!test_array.includes(value)) {
              console.log(`ADDING missing integrity field : ${value}`);
              meta.userPermissions.push({ enabled: 'true', name: value });
              test_array.push(value);
            }
          });
        } else if (element.statusCode === 'INVALID_CROSS_REFERENCE_KEY') {
          let type = element.message.split('field:');


          type = type[1].split('-');


          type = type[0].trim();

          // console.log("TIPO:              "+type);

          let mesa = element.message.split('named');

          mesa = mesa[1].split('found');
          mesa = mesa[0].trim();
          switch (type) {
            case 'apexClass':
              meta.classAccesses = meta.classAccesses.filter(el => el.apexClass !== mesa);
              console.log(`DELETED classAccesses: ${mesa}`);
              break;
            case 'apexPage':
              meta.classAccesses = meta.classAccesses.filter(el => el.apexClass !== mesa);
              console.log(`DELETED classAccesses: ${mesa}`);
              break;
            case 'recordType':
              meta.recordTypeVisibilities = meta.recordTypeVisibilities.filter(el => el.recordType !== mesa);
              console.log(`DELETED recordTypeVisibilities: ${mesa}`);
              break;
            case 'tab':
              meta.tabVisibilities = meta.tabVisibilities.filter(el => el.tab !== mesa);
              console.log(`DELETED tabVisibilities: ${mesa}`);
              break;
            case 'field':
              meta.fieldPermissions = meta.fieldPermissions.filter(el => el.field.indexOf(mesa) === -1);
              console.log(`DELETED fieldPermissions: ${mesa}`);
              break;
            case 'object':
              meta.objectPermissions = meta.objectPermissions.filter(el => el.object !== mesa);
              console.log(`DELETED objectPermissions: ${mesa}`);
              break;
            case 'layout':
              meta.layoutAssignments = meta.layoutAssignments.filter(el => el.layout.indexOf(mesa) === -1);
              console.log(`DELETED layoutAssignments: ${mesa}`);
              break;
            default:
              console.log(`ERROR: NOT RECOGNIZED TYPE: ${type}`);
              break;
          }
        } else {
          console.log(element);
          return (element, null);
        }
      });
      //  console.log(meta);
      sfdeploy(connection, meta);
    } else {
      console.log('---- Process ended ----');
      console.log(`success ? : ${results.success}`);
      console.log(`created ? : ${results.created}`);
      console.log(`Profile : ${results.fullName}`);

      fs.writeFileSync(`${fullNames[0].replace(/ /g, '_')}-profileMetadata-deployed.json`, JSON.stringify(meta, null, 2), 'utf-8');
      console.log(`Please refer to : ${fullNames[0].replace(/ /g, '_')}-profileMetadata-deployed.json`);
    }
  });
}


async function main() {
  await sfConnect(username_retrieve, password_retrieve, conn);
  // console.log(conn.accessToken);
  await sfConnect(username_deploy, password_deploy, conndeploy);
  // console.log(conndeploy.accessToken);

  await sfRetrieve(conn);
  await fs.writeFileSync(`${fullNames[0].replace(/ /g, '_')}-profileMetadata.json`, JSON.stringify(metadata, null, 2), 'utf-8');
  // metadata
  // console.log(metadata);
  await sfdeploy(conndeploy, metadata);
  // console.log(results);
}

main();
