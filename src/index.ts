//    Copyright 2017 Google
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

/// <reference path="../node_modules/@types/applepayjs/index.d.ts" />

export let PaymentRequest;

if ((<any>window).ApplePaySession) {
  const APPLE_PAY_JS_IDENTIFIER = 'https://apple.com/apple-pay';
  PaymentRequest = class {
    private paymentRequest: ApplePayJS.ApplePayPaymentRequest;
    public paymentRequestID: string = '';
    public shippingAddress: PaymentAddress = null;
    public shippingOption: string = '';
    public shippingType: string = 'shipping';
    private version: number = 1;
    private session: ApplePaySession;
    private paymentResolver = null;
    private paymentRejector = null;
    public onshippingaddresschange = null;
    public onshippingoptionchange = null;
    public onpaymentmethodselected = null;

    private validationEndpoint: string = '';
    private merchantIdentifier: string = '';
    private unknownErrorMessage: string = 'An unknown error occurred, please try again';

    /**
     * @param  {PaymentMethodData[]} methodData
     * @param  {PaymentDetails} details
     * @param  {PaymentOptions} options
     */
    constructor(
      methodData: PaymentMethodData[],
      details: PaymentDetails,
      options: PaymentOptions
    ) {
      let methodSpecified = false;
      this.paymentRequest = {
        countryCode: '',
        currencyCode: '',
        lineItems: [],
        merchantCapabilities: ['supports3DS'],
        supportedNetworks: [],
        total: null,
        billingContact: null,
        requiredBillingContactFields: [],
        requiredShippingContactFields: [],
        shippingContact: null,
        shippingMethods: <ApplePayJS.ApplePayShippingMethod[]>[],
        shippingType: 'shipping',
      };

      if (ApplePaySession.supportsVersion(3)) {
        this.version = 3;
      } else if (ApplePaySession.supportsVersion(2)) {
        this.version = 2;
      }

      // methodData
      for (let method of methodData) {
        // If `supportedMethods` includes `https://apple.com/apple-pay`...
        if (method.supportedMethods.indexOf(APPLE_PAY_JS_IDENTIFIER) > -1) {
          this.paymentRequest.supportedNetworks = method.data.supportedNetworks;
          this.paymentRequest.countryCode = method.data.countryCode;
          if (method.data.billingContact) {
            this.paymentRequest.billingContact = method.data.billingContact;
          } else {
            delete this.paymentRequest.billingContact;
          }
          if (method.data.shippingContact) {
            this.paymentRequest.shippingContact = method.data.shippingContact;
          } else {
            delete this.paymentRequest.shippingContact;
          }
          if (method.data.merchantCapabilities) {
            this.paymentRequest.merchantCapabilities = method.data.merchantCapabilities;
          }
          if (this.version == 3 &&  Array.isArray(method.data.supportedCountries)) {
            this.paymentRequest.supportedCountries = method.data.supportedCountries;
          }
          if (method.data.unknownErrorMessage) {
            this.unknownErrorMessage = method.data.unknownErrorMessage;
          }

          this.validationEndpoint = method.data.validationEndpoint;
          this.merchantIdentifier = method.data.merchantIdentifier;
          methodSpecified = true;
          break;
        }
      }

      if (!methodSpecified) {
        throw 'Payment method not specified for Apple Pay.';
      }

      // details
      if (details) {
        this.updatePaymentDetails(details);
      }

      // options
      if (options) {
        if (options.requestShipping) {
          this.paymentRequest.requiredBillingContactFields.push('postalAddress');
          this.paymentRequest.requiredShippingContactFields.push('postalAddress');
        }
        if (options.requestPayerName) {
          this.paymentRequest.requiredShippingContactFields.push('name');
        }
        if (options.requestPayerEmail) {
          this.paymentRequest.requiredShippingContactFields.push('email');
        }
        if (options.requestPayerPhone) {
          this.paymentRequest.requiredShippingContactFields.push('phone');
        }
        if (options.shippingType === 'pickup') {
          this.paymentRequest.shippingType = 'servicePickup';
        } else {
          this.paymentRequest.shippingType = <ApplePayJS.ApplePayShippingType> options.shippingType || 'shipping';
        }
      }

      this.session = new ApplePaySession(this.version, this.paymentRequest);

      this.session.addEventListener('validatemerchant',
        this.onValidateMerchant.bind(this));
      this.session.addEventListener('paymentauthorized',
        this.onPaymentAuthorized.bind(this));
      this.session.addEventListener('paymentmethodselected',
        this.onPaymentMethodSelected.bind(this));
      this.session.addEventListener('shippingcontactselected',
        this.onShippingAddressChange.bind(this));
      this.session.addEventListener('shippingmethodselected',
        this.onShippingOptionChange.bind(this));
      this.session.addEventListener('cancel',
        this.onPaymentCanceled.bind(this));
    }

    /**
     * @param  {PaymentDetails} details
     */
    private updatePaymentDetails(details: PaymentDetails) {
      if (details.displayItems) {
        this.paymentRequest.lineItems = <ApplePayJS.ApplePayLineItem[]>[];
        for (let item of details.displayItems) {
          let lineItem: ApplePayJS.ApplePayLineItem = {
            type: item.pending === true ? 'pending' : 'final',
            label: item.label,
            amount: item.amount.value
          }
          this.paymentRequest.lineItems.push(lineItem);
        }
      }

      if (details.shippingOptions) {
        this.paymentRequest.shippingMethods = <ApplePayJS.ApplePayShippingMethod[]>[];
        for (let option of details.shippingOptions) {
          let shippingMethod: ApplePayJS.ApplePayShippingMethod = {
            label: (option.label.indexOf('-') ? option.label.substring(0, option.label.indexOf('-')) : option.label).trim(),
            detail: (option.label.indexOf('-') ? option.label.substring(option.label.indexOf('-')+1) : '').trim(),
            amount: option.amount.value,
            identifier: option.id
          };
          this.paymentRequest.shippingMethods.push(shippingMethod);
        }
      }

      if (details.total) {
        this.paymentRequest.currencyCode = details.total.amount.currency;
        this.paymentRequest.total = {
          type: details.total.pending === true ? 'pending' : 'final',
          label: details.total.label,
          amount: details.total.amount.value
        };
      }
    }

    /**
     * @param  {ApplePayJS.ApplePayPaymentMethod} paymentMethod
     */
    private updatePaymentMethod(paymentMethod: ApplePayJS.ApplePayPaymentMethod) {

    }

    /**
     * @param  {ApplePayJS.ApplePayPaymentContact} shippingContact
     */
    private convertPaymentAddress(contact: ApplePayJS.ApplePayPaymentContact): PaymentAddress {
      let address = {
        country:            contact.countryCode || '',
        addressLine:        contact.addressLines || [],
        region:             contact.administrativeArea || '',
        city:               contact.locality || '',
        dependentLocality:  '',
        postalCode:         contact.postalCode || '',
        sortingCode:        contact.country || '',
        languageCode:       '',
        organization:       '',
        recipient:          `${contact.givenName} ${contact.familyName}`,
        phone:              contact.phoneNumber || ''
      }
      return <PaymentAddress>address;
    }

    /**
     * @param  {ApplePayJS.ApplePayShippingMethod} shippingMethod
     */
    private convertShippingMethod(shippingMethod: ApplePayJS.ApplePayShippingMethod): string {
      for (let method of this.paymentRequest.shippingMethods) {
        if (shippingMethod.identifier === method.identifier) {
          return method.identifier;
        }
      }
      return '';
    }

    /**
     * @param {ApplePayJS.ApplePayPayment} payment
     * @returns {any} response
     */
    private convertPaymentResponse(payment: ApplePayJS.ApplePayPayment): any {
      let shippingAddress = this.convertPaymentAddress(payment.shippingContact);
      let billingAddress = this.convertPaymentAddress(payment.billingContact);
      let response = {
        details: {
          billingAddress:   billingAddress
        },
        methodName:       APPLE_PAY_JS_IDENTIFIER,
        payerEmail:       payment.shippingContact.emailAddress,
        payerName:        `${payment.billingContact.givenName} ${payment.billingContact.familyName}`,
        payerPhone:       payment.shippingContact.phoneNumber,
        shippingAddress:  shippingAddress,
        shippingOption:   '',
        applePayRaw:      payment,
        complete:         this.onPaymentComplete.bind(this)
      };
      return response;
    }

    /**
     * @returns Promise
     */
    public show(): Promise<PaymentResponse> {
      this.session.begin();
      return new Promise((resolve, reject) => {
        this.paymentResolver = (response: ApplePayJS.ApplePayPayment) => {
          // response.complete = this.onPaymentComplete;
          resolve(<any>response);
        };
        this.paymentRejector = (error: Error) => {
          reject(error);
        };
      });
    }

    /**
     * @returns Promise
     */
    public restart(): Promise<PaymentResponse> {
      return new Promise((resolve, reject) => {
        this.paymentResolver = (response: ApplePayJS.ApplePayPayment) => {
          // response.complete = this.onPaymentComplete;
          resolve(<any>response);
        };
        this.paymentRejector = (error: Error) => {
          reject(error);
        };
      });
    }

    /**
     * @returns Promise
     */
    public abort(): Promise<void> {
      // TODO: Does `cancel` event fire by itself?
      return Promise.resolve(this.session.abort());
    }

    /**
     * @returns Promise
     */
    public canMakePayment(): Promise<boolean> {
      if (this.merchantIdentifier) {
        return ApplePaySession.canMakePaymentsWithActiveCard(this.merchantIdentifier);
      } else {
        throw '`merchantIdentifier` is not specified.';
      }
    }

    public completeMerchantValidation(merchantSession: any): void {
      // https://developer.apple.com/reference/applepayjs/applepaysession/1778015-completemerchantvalidation
      this.session.completeMerchantValidation(merchantSession);
    }

    public completePaymentMethodSelection(newTotal: ApplePayJS.ApplePayLineItem, newLineItems: ApplePayJS.ApplePayLineItem[]): void {
      // https://developer.apple.com/reference/applepayjs/applepaysession/1777995-completepaymentmethodselection
      if (this.version == 3) {
        let paymentMethodUpdate: ApplePayJS.ApplePayPaymentMethodUpdate = {
          newLineItems: newLineItems,
          newTotal: newTotal,
        };
        this.session.completePaymentMethodSelection(paymentMethodUpdate);
      } else {
        this.session.completePaymentMethodSelection(newTotal, newLineItems);
      }
    }

    /**
     * @param  {string} type
     * @param  {(e:Event)=>any} callback
     * @returns void
     */
    public addEventListener(type: string, callback: (e: Event) => any): void {
      if (type === 'shippingaddresschange' ||
          type === 'shippingoptionchange' ||
          type === 'paymentmethodselected' ||
          type === 'validatemerchant') {
        this[`on${type}`] = callback;
      } else {
        throw `Unknown event type "${type}" for \`addEventListener\`.`;
      }
    }

    /**
     * @param  {ApplePayJS.ApplePayValidMerchantEvent} e
     * @returns void
     */
    private onValidateMerchant(
      e: ApplePayJS.ApplePayValidateMerchantEvent
    ): void {
      e.stopPropagation();
      // https://developer.apple.com/reference/applepayjs/applepaysession/1778021-onvalidatemerchant
      if (this['onvalidatemerchant']) {
        this['onvalidatemerchant'](e);
      } else {
        Promise.resolve(new Promise((resolve, reject) => {
          let xhr = new XMLHttpRequest();
          xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
          xhr.onerror = () => reject(new Error(xhr.statusText));
          xhr.open('POST', this.validationEndpoint, true);
          xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
          xhr.send(JSON.stringify({validationURL: e.validationURL}));
        })).then(res => {
          if ((res as any).status === 200) {
            return JSON.parse((res as any).body);
          } else {
            throw 'Merchant validation error.';
          }
        }).then((merchantSession: any) => {
          this.completeMerchantValidation(merchantSession);
        }).catch(error => {
          throw error;
        });
      }
    }

    /**
     * @param  {ApplePayJS.ApplePayPaymentMethodSelectedEvent} e
     * @returns void
     */
    private onPaymentMethodSelected(
      e: ApplePayJS.ApplePayPaymentMethodSelectedEvent
    ): void {
      e.stopPropagation();
      // https://developer.apple.com/reference/applepayjs/applepaysession/1778013-onpaymentmethodselected
      if (this['onpaymentmethodselected']) {
        this['onpaymentmethodselected'](e);
      } else {
        let newTotal = this.paymentRequest.total;
        let newLineItems = this.paymentRequest.lineItems;
        this.session.completePaymentMethodSelection(newTotal, newLineItems);
      }
    }

    /**
     * @param  {ApplePayJS.ApplePayShippingContactSelectedEvent} e
     * @returns void
     */
    private onShippingAddressChange(
      e: ApplePayJS.ApplePayShippingContactSelectedEvent
    ): void {
      if (!this['onshippingaddresschange']) return;
      e.stopPropagation();

      // Convert ApplePay ShippingContact into PaymentRequest PaymentAddress
      // https://developer.apple.com/reference/applepayjs/applepaysession/1778009-onshippingcontactselected
      let shippingContact = e.shippingContact;
      this.shippingAddress = this.convertPaymentAddress(shippingContact);

      this['onshippingaddresschange']({
        updateWith: p => {
          Promise.resolve(p).then((details: PaymentDetails) => {
            // https://developer.apple.com/reference/applepayjs/applepaysession/1778008-completeshippingcontactselection
            this.updatePaymentDetails(details);
            if (this.version == 3) {
              let shippingContactUpdate: ApplePayJS.ApplePayShippingContactUpdate = {
                errors: ((<any>details).appleError) ? (<any>details).appleError : [],
                newLineItems: this.paymentRequest.lineItems,
                newShippingMethods: this.paymentRequest.shippingMethods,
                newTotal: this.paymentRequest.total,
              }
              this.session.completeShippingContactSelection(shippingContactUpdate);
            } else {
              this.session.completeShippingContactSelection(
                (details.error) ? ApplePaySession.STATUS_FAILURE : ApplePaySession.STATUS_SUCCESS,
                this.paymentRequest.shippingMethods,
                this.paymentRequest.total,
                this.paymentRequest.lineItems);
            }
          }, (details: PaymentDetails) => {
            this.updatePaymentDetails(details);
            if (this.version == 3) {
              let shippingContactUpdate: ApplePayJS.ApplePayShippingContactUpdate = {
                errors: ((<any>details).appleError) ? (<any>details).appleError : [ new ApplePayError('unknown') ],
                newLineItems: this.paymentRequest.lineItems,
                newShippingMethods: this.paymentRequest.shippingMethods,
                newTotal: this.paymentRequest.total,
              }
              this.session.completeShippingContactSelection(shippingContactUpdate);
            } else {
              this.session.completeShippingContactSelection(
                ApplePaySession.STATUS_FAILURE,
                this.paymentRequest.shippingMethods,
                this.paymentRequest.total,
                this.paymentRequest.lineItems);
            }
          });
        }
      });
    }

    /**
     * @param  {ApplePayJS.ApplePayShippingMethodSelectedEvent} e
     * @returns void
     */
    private onShippingOptionChange(
      e: ApplePayJS.ApplePayShippingMethodSelectedEvent
    ): void {
      if (!this['onshippingoptionchange']) return;
      e.stopPropagation();

      // Convert ApplePay ShippingMethod into PaymentRequest PaymentShippingOption id
      // https://developer.apple.com/reference/applepayjs/applepaysession/1778028-onshippingmethodselected
      let shippingMethod = e.shippingMethod;
      this.shippingOption = this.convertShippingMethod(shippingMethod);

      this['onshippingoptionchange']({
        updateWith: p => {
          Promise.resolve(p).then((details: PaymentDetails) => {
            // https://developer.apple.com/reference/applepayjs/applepaysession/1778024-completeshippingmethodselection
            this.updatePaymentDetails(details);
            if (this.version == 3) {
              if (details.error) {
                this.abort().then(function() {
                  alert(details.error);
                });
              } else {
                let shippingMethodUpdate: ApplePayJS.ApplePayShippingMethodUpdate = {
                  newLineItems: this.paymentRequest.lineItems,
                  newTotal: this.paymentRequest.total,
                };
                this.session.completeShippingMethodSelection(shippingMethodUpdate);
              }
            } else {
              this.session.completeShippingMethodSelection(
                ApplePaySession.STATUS_SUCCESS,
                this.paymentRequest.total,
                this.paymentRequest.lineItems);
            }
          }, (details: PaymentDetails) => {
            this.updatePaymentDetails(details);
            if (this.version == 3) {
              var error = this.unknownErrorMessage;
              this.abort().then(function() {
                alert(error);
              });
            } else {
              this.session.completeShippingMethodSelection(
                ApplePaySession.STATUS_FAILURE,
                null,
                null
              );
            }
          });
        }
      })
    }

    /**
     * @param  {ApplePayJS.ApplePayPaymentAuthorizedEvent} e
     * @returns void
     */
    private onPaymentAuthorized(
      e: ApplePayJS.ApplePayPaymentAuthorizedEvent
    ): void {
      if (this.paymentResolver) {
        let response = this.convertPaymentResponse(e.payment);
        // https://developer.apple.com/reference/applepayjs/payment
        this.paymentResolver(response);
        this.paymentResolver = null;
        this.paymentRejector = null;
      }
    }

    /**
     * @returns void
     */
    private onPaymentCanceled(): void {
      if (this.paymentRejector) {
        var error = new Error('Payment request cancelled');
        error.name = 'AbortError';
        this.paymentRejector(error);
        this.paymentResolver = null;
        this.paymentRejector = null;
      }
    }

    /**
     * @param  {'success' | 'fail' | 'unknown'} result
     * @returns Promise
     */
    private onPaymentComplete(result: 'success' | 'fail' | 'unknown'): Promise<any> {
      if (result === 'success' ||
          result === 'fail' ||
          result === 'unknown' ||
          result === '') {
        let status: number;
        switch (result) {
          case 'success':
            status = ApplePaySession.STATUS_SUCCESS;
            break;
          case 'fail':
            status = ApplePaySession.STATUS_FAILURE;
            break;
          case 'unknown':
            status = ApplePaySession.STATUS_FAILURE;
            break;
          default:
            // TODO: Not sure what is the best way to handle this
            // Treat is as success for the time being.
            status = ApplePaySession.STATUS_SUCCESS;
            break;
        }
        // https://developer.apple.com/reference/applepayjs/applepaysession/1778012-completepayment
        if (this.version == 3) {
          let paymentAuthorizationResult: ApplePayJS.ApplePayPaymentAuthorizationResult;
          if (status == ApplePaySession.STATUS_SUCCESS) {
            paymentAuthorizationResult = {
              status: status
            };
          } else {
            paymentAuthorizationResult = {
              status: status,
              errors: ((<any>window).appleError) ? (<any>window).appleError : [ new ApplePayError('unknown') ],
            };
          }
          console.log(paymentAuthorizationResult);
          return Promise.resolve(this.session.completePayment(paymentAuthorizationResult));
        } else {
          return Promise.resolve(this.session.completePayment(status));
        }
      } else {
        throw 'Unknown status code for complete().';
      }
    }
  }
}
