import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {EOSJSService} from '../../eosjs.service';
import {Subject} from 'rxjs';
import {AccountsService} from '../../accounts.service';

@Injectable({
  providedIn: 'root'
})
export class VotingService {

  public bps: any[];
  public cachedList: any[];
  public listReady = new Subject<Boolean>();
  public counter = new Subject<Number>();
  selectedAccount: any;
  initList: boolean;
  totalActivatedStake: number;
  totalProducerVoteWeight: number;
  chainActive: boolean;
  stakePercent: number;

  constructor(private eos: EOSJSService, private http: HttpClient, private aService: AccountsService) {
    this.bps = [];
    this.initList = false;
    this.chainActive = false;
    this.totalActivatedStake = 0;
    this.totalProducerVoteWeight = 0;
    this.stakePercent = 0;
    this.startUpdateGlobalStake();
    this.aService.selected.asObservable().subscribe((sA) => {
      this.selectedAccount = sA;
      if (this.bps.length === 0 && !this.initList) {
        this.listProducers();
      }
    });
  }

  static shuffle(array) {
    let currentIndex = array.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }
    return array;
  }

  randomizeList() {
    this.bps = VotingService.shuffle(this.bps);
  }

  updateGlobalStake() {
    this.eos.getChainInfo().then((global) => {
      this.totalActivatedStake = parseInt(global.rows[0]['total_activated_stake'], 10) / 10000;
      this.stakePercent = (Math.round((100 * this.totalActivatedStake / 150000000.0) * 1000) / 1000);
    });
  }

  startUpdateGlobalStake() {
    this.updateGlobalStake();
    setInterval(() => {
      this.updateGlobalStake();
    }, 10000);
  }

  listProducers() {
    if (this.initList === false) {
      this.initList = true;
      this.aService.initFirst();
      this.eos.listProducers().then((producers) => {
        this.eos.getChainInfo().then((global) => {
          this.totalActivatedStake = parseInt(global.rows[0]['total_activated_stake'], 10) / 10000;
          this.totalProducerVoteWeight = parseFloat(global.rows[0]['total_producer_vote_weight']);
          this.chainActive = this.totalActivatedStake > 150000000.0;
          const total_votes = this.totalProducerVoteWeight;
          // Pass 1 - Add accounts
          const myAccount = this.aService.selected.getValue();
          producers.rows.forEach((prod: any, idx) => {
            const vote_pct: any = Math.round((100 * prod['total_votes'] / total_votes) * 1000) / 1000;
            const voted = myAccount.details['voter_info']['producers'].indexOf(prod['owner']) !== -1;
            const producerMetadata = {
              name: prod['owner'],
              account: prod['owner'],
              key: prod['producer_key'],
              location: '',
              position: idx + 1,
              status: (idx < 21 && this.chainActive) ? 'producing' : 'standby',
              total_votes: vote_pct + '%',
              social: '',
              email: '',
              website: prod.url,
              logo_256: '',
              code: '',
              checked: voted
            };
            this.bps.push(producerMetadata);
          });
          this.listReady.next(true);
          // Pass 2 - Enhance metadata
          producers.rows.forEach((prod: any, idx) => {
            const cachedPayload = JSON.parse(localStorage.getItem(prod['owner']));
            if (cachedPayload) {
              if (new Date().getTime() - new Date(cachedPayload.lastUpdate).getTime() > (1000 * 60 * 60 * 6)) {
                setTimeout(() => {
                  this.improveMeta(prod, idx);
                }, 100 + idx * 10);
              } else {
                this.bps[idx] = cachedPayload['meta'];
              }
            } else {
              setTimeout(() => {
                this.improveMeta(prod, idx);
              }, 100 + idx * 10);
            }
          });
        });
      });
    }
  }

  improveMeta(prod, idx) {
    if (prod.url !== '') {
      const url = prod.url.endsWith('.json') ? prod.url : prod.url + '/bp.json';
      if (url !== '') {
        this.http.post('http://proxy.eosrio.io:4200', {
          url: url
        }).subscribe((data) => {
          if (data) {
            if (data['org']) {
              const org = data['org'];
              let loc = ' - ';
              if (org['location']) {
                loc = (org.location.name) ? (org.location.name + ', ' + org.location.country) : (org.location.country);
              }
              const logo_256 = (org['branding']) ? org['branding']['logo_256'] : '';
              if (data['producer_account_name'] === prod['owner']) {
                this.bps[idx].name = org['candidate_name'];
                this.bps[idx].account = data['producer_account_name'];
                this.bps[idx].location = loc;
                this.bps[idx].social = org['social'] || {};
                this.bps[idx].email = org['email'];
                this.bps[idx].website = org['website'];
                this.bps[idx].logo_256 = logo_256;
                this.bps[idx].code = org['code_of_conduct'];

                // Add to cache
                const payload = {
                  lastUpdate: new Date(),
                  meta: this.bps[idx],
                  source: url
                };
                localStorage.setItem(prod['owner'], JSON.stringify(payload));
              }
            }
          }
        }, () => {
          // console.log(url, err);
        });
      }
    } else {
      // console.log(prod['owner'] + ' provided no bp.json');
    }
  }
}
