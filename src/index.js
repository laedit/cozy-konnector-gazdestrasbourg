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

  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/AfficherFacture.aspx`)
  log('info', 'Parsing list of documents')

  const bills = await parseBills($)

  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields.folderPath, {
    identifiers: ['es energies strasbourg', 'es', 'strasbourg', 'energies']
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
async function parseBills($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape

  let billsLines = $('#cphContenu_gvHistoFactures > tbody')
    // get rid of hided lines and inline tables
    .children('tr:not([style="display:none"])');

  let bills = billsLines.filter(function (i, el) {
    return $(el).children('td').length > 1
  })
    .map(function (i, el) {
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
    .toArray();

  // Check if there is a next page of bills
  return bills.concat(await getNextPage($, billsLines));
}

async function getNextPage($, billsLines) {

  const lastTds = $(billsLines).last().children('td');
  if (lastTds.length === 1) {
    const nextPageTd = lastTds.first().find('td:has(span)').next();
    if (nextPageTd !== undefined && nextPageTd.children().length > 0) {

      const nextPageLink = nextPageTd.children().first();
      const nextPageNumber = nextPageLink.text();
      let nextPageArgs = nextPageLink.attr('href').substring(25); // remove javascript:__doPostBack('
      let [eventTarget, eventArgument] = nextPageArgs.substring(0, nextPageArgs.length - 2).split(',');
      eventTarget = eventTarget.substring(0, eventTarget.length - 1);
      eventArgument = eventArgument.substring(1);
      // in this case signin is used only to submit a form
      const $nextPage = await signin({
        url: `${baseUrl}/AfficherFacture.aspx`,
        formSelector: '#formMaster',
        formData: {
          __EVENTTARGET: eventTarget,
          __EVENTARGUMENT: eventArgument
        },
        validate: (statusCode, $) => {
          // check that the page is the page targeted
          if (statusCode === 200
            && $(`#cphContenu_gvHistoFactures td > span`).length === 1
            && $(`#cphContenu_gvHistoFactures td > span`).eq(0).text() === nextPageNumber) {
            return true;
          }
          else {
            throw new Error(`Error during navigation to page ${nextPageNumber} of bills.`);
          }
        }
      });
      return await parseBills($nextPage);
    }
  }
  return [];
}
