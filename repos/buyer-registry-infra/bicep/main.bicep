param environment string
param location string = resourceGroup().location
param sku string = 'S1'

module networking './modules/networking.bicep' = {
  name: 'networking'
  params: {
    environment: environment
    location: location
  }
}

module database './modules/postgres.bicep' = {
  name: 'database'
  params: {
    environment: environment
    location: location
    sku: sku
  }
}

module cognitiveSearch './modules/search.bicep' = {
  name: 'cognitiveSearch'
  params: {
    environment: environment
    location: location
  }
}

output databaseConnectionString string = database.outputs.connectionString
