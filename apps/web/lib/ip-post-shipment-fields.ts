export type IpPostShipmentField = {
  key: string;
  label: string;
  type?: "date" | "number" | "money" | "boolean" | "select";
  max?: number;
  entity?: string;
  /** Costs belong to the whole shipment; repeating them on each product would duplicate them. */
  ipOnly?: boolean;
};

// The API accepts exactly these keys in PATCH /processes/:id/followup.
export const ipPostShipmentFields: IpPostShipmentField[] = [
  { key: "logisticsStatus", label: "Status logístico", type: "select", entity: "logistics_status" },
  { key: "priority", label: "Prioridade do IP", type: "select", entity: "priority" },
  { key: "ipTotvsDate", label: "Data do IP no TOTVS", type: "date" },
  { key: "transportMode", label: "Modal", type: "select", entity: "transport_mode" },
  { key: "incoterm", label: "Incoterm", type: "select", entity: "incoterm" },
  { key: "broker", label: "Despachante", type: "select", entity: "broker" },
  { key: "portLoading", label: "Porto de origem (POL)", type: "select", entity: "port_loading" },
  { key: "portDischarge", label: "Porto de destino (POD)", type: "select", entity: "port_discharge" },
  { key: "etd", label: "ETD", type: "date" },
  { key: "actualPortDepartureDate", label: "Saída efetiva do porto de origem (Departure)", type: "date" },
  { key: "blNumber", label: "BL nº", max: 120 },
  { key: "blDate", label: "BL date", type: "date" },
  { key: "etaConfirmed", label: "ETA confirmada", type: "date" },
  { key: "arrivalDate", label: "Chegada efetiva (Arrival)", type: "date" },
  { key: "duimpNumber", label: "DUIMP", max: 100 },
  { key: "duimpDate", label: "Registro da DUIMP", type: "date" },
  { key: "customsChannel", label: "Canal aduaneiro", type: "select", entity: "customs_channel" },
  { key: "clearanceDate", label: "Desembaraço", type: "date" },
  { key: "eteConfirmed", label: "ETE confirmada", type: "date" },
  { key: "nfRequestDate", label: "Solicitação da NF", type: "date" },
  { key: "deliveryDate", label: "Entrega efetiva", type: "date" },
  { key: "freightCurrency", label: "Moeda do frete", type: "select", entity: "currency", ipOnly: true },
  { key: "freightCost", label: "Frete", type: "money", ipOnly: true },
  { key: "containerNumber", label: "Container", max: 120 },
  { key: "containerType", label: "Tipo de container", type: "select", entity: "container_type" },
  { key: "containerQuantity", label: "Quantidade de containers", type: "number", ipOnly: true },
  { key: "forwarder", label: "Agente de carga", type: "select", entity: "forwarder" },
  { key: "documentsOk", label: "Documentação conferida", type: "boolean" },
  { key: "storageDueOverride", label: "Vencimento confirmado da armazenagem", type: "date" },
  { key: "taxesPaidBrl", label: "Impostos pagos (R$)", type: "money", ipOnly: true },
  { key: "fineBrl", label: "Multa (R$)", type: "money", ipOnly: true },
  { key: "storageBrl", label: "Armazenagem (R$)", type: "money", ipOnly: true },
  { key: "demurrageBrl", label: "Demurrage (R$)", type: "money", ipOnly: true },
  { key: "demurrageContainerQuantity", label: "Containers com demurrage", type: "number", ipOnly: true },
];

/** IP fields repeated on each product line of the IP. */
export const productLineIpFields = ipPostShipmentFields.filter(field => !field.ipOnly);

/** BL is typed on the IP; legacy BL documents remain only as history. */
export const newProcessDocumentKinds = ["INVOICE", "NF"];
