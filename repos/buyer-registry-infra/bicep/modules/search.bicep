param environment string
param location string

resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: 'buyer-registry-${environment}-search'
  location: location
  sku: {
    name: 'standard'
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
  }
}

output searchEndpoint string = 'https://' + search.name + '.search.windows.net'
