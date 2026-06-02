// JP-vertical SHACL shape registry helpers.
//
// PD-15: JP-specific Description shapes (JpFacilitatorAssociationDescription,
// JpAdopterAssociationDescription) live in the app, NOT in packages. The
// generic verifiable-credentials package ships the registration helper +
// envelope; we ship the JP shape definitions here.
//
// These shape strings would be registered into the on-chain ShapeRegistry
// at deploy time. For the demo we keep them inline + use the helper from
// `verifiable-credentials` to compute the canonical hash.

import { shapeHash, buildShapeUri } from '@agenticprimitives/verifiable-credentials';

export const JP_FACILITATOR_ASSOCIATION_SHACL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix jp:     <https://demo-jp.example.com/ns/jp#> .

jp:JpFacilitatorAssociationDescription a sh:NodeShape ;
    sh:targetClass jp:JpFacilitatorAssociation ;
    sh:property [
        sh:path jp:facilitatorRole ;
        sh:datatype xsd:string ;
        sh:in ( "approved" "verified" "trusted" ) ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:facilitatorCountries ;
        sh:datatype xsd:string ;
        sh:minCount 1
    ] ;
    sh:property [
        sh:path jp:fpgIds ;
        sh:datatype xsd:string ;
        sh:minCount 1
    ] ;
    sh:property [
        sh:path jp:validUntil ;
        sh:datatype xsd:dateTime ;
        sh:maxCount 1
    ] .
`.trim();

export const JP_ADOPTER_ASSOCIATION_SHACL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix jp:     <https://demo-jp.example.com/ns/jp#> .

jp:JpAdopterAssociationDescription a sh:NodeShape ;
    sh:targetClass jp:JpAdopterAssociation ;
    sh:property [
        sh:path jp:adopterType ;
        sh:datatype xsd:string ;
        sh:in ( "individual" "family" "group" "church" "organization" "network" ) ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:fpgId ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:mouHash ;
        sh:datatype xsd:hexBinary ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:validUntil ;
        sh:datatype xsd:dateTime ;
        sh:maxCount 1
    ] .
`.trim();

export const JP_AGREEMENT_SHACL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix jp:     <https://demo-jp.example.com/ns/jp#> .

jp:JpAgreementDescription a sh:NodeShape ;
    sh:targetClass jp:JpAgreement ;
    sh:property [
        sh:path jp:agreementKind ;
        sh:datatype xsd:string ;
        sh:in ( "facilitator-adopter" "facilitator-network" "fund-disbursement" ) ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:fpgId ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:termsHash ;
        sh:datatype xsd:hexBinary ;
        sh:minCount 1 ;
        sh:maxCount 1
    ] ;
    sh:property [
        sh:path jp:capabilityList ;
        sh:datatype xsd:string ;
        sh:minCount 1
    ] .
`.trim();

/** Registry of all JP-vertical shape URIs + their on-chain hashes. */
export const JP_SHAPES = {
  facilitator: {
    name: 'JpFacilitatorAssociationDescription',
    version: 'v1',
    uri: buildShapeUri('JpFacilitatorAssociationDescription', 'v1'),
    shacl: JP_FACILITATOR_ASSOCIATION_SHACL,
    get hash() {
      return shapeHash(JP_FACILITATOR_ASSOCIATION_SHACL);
    },
  },
  adopter: {
    name: 'JpAdopterAssociationDescription',
    version: 'v1',
    uri: buildShapeUri('JpAdopterAssociationDescription', 'v1'),
    shacl: JP_ADOPTER_ASSOCIATION_SHACL,
    get hash() {
      return shapeHash(JP_ADOPTER_ASSOCIATION_SHACL);
    },
  },
  agreement: {
    name: 'JpAgreementDescription',
    version: 'v1',
    uri: buildShapeUri('JpAgreementDescription', 'v1'),
    shacl: JP_AGREEMENT_SHACL,
    get hash() {
      return shapeHash(JP_AGREEMENT_SHACL);
    },
  },
} as const;
