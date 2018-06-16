const {
  BaseKonnector,
  requestFactory,
  signin,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})
const moment = require('moment')
moment.locale('fr')
const baseUrl = 'https://agence-en-ligne.es-gazdestrasbourg.fr'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/AfficherFacture.aspx`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['gaz']
  })
}

function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/Login.aspx`,
    formSelector: '#frmSendCodes',
    formData: {
      txtNomUtilisateur: username,
      txtPassword: password,
      __EVENTTARGET: 'btnAuthentification'
    },
    validate: (statusCode, $) => {
      if (statusCode === 200 && $(`#butDeconnexion`).length === 1) {
        return true
      } else {
        if ($('#lblErreur').text()) {
          log('error', $('#lblErreur').text())
        }
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape

  let docs = $('#cphContenu_gvHistoFactures > tbody')
    // get rid of hided lines and inline tables
    .children('tr:not([style="display:none"])')
    .filter(function(i, el) {
      return $(el).children('td').length > 1
    })
    .map(function(i, el) {
      return {
        title: $(el)
          .children()
          .eq(1)
          .text()
          .trim(),
        date: new Date(
          $(el)
            .children()
            .eq(2)
            .text()
            .trim()
            .split('/')
            .reverse()
            .join('/') + ' 00:00:00 GMT' // had to do this to deal with the month index / timezone issue
        ),
        amount: $(el)
          .children()
          .eq(4)
          .text()
          .trim(),
        filename: `${$(el)
          .children()
          .eq(1)
          .text()
          .trim()}.pdf`,
        fileurl: `${baseUrl}/Telecharger.aspx`,
        currency: '€',
        vendor: 'ES Energies Strasbourg',
        metadata: {
          // it can be interesting that we add the date of import. This is not mandatory but may be
          // usefull for debugging or data migration
          importDate: new Date(),
          // document version, usefull for migration after change of document structure
          version: 1
        }
      }
    })
    .toArray()

  return docs
}
