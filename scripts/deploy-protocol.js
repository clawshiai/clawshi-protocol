import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import solc from 'solc';

// Config
const RPC_URL = process.env.MAINNET_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY;
const USDC_ADDRESS = process.env.MAINNET_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

if (!PRIVATE_KEY) {
  console.error('Missing MAINNET_PRIVATE_KEY in .env');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('Clawshi Protocol Deployment - Base Mainnet');
console.log('='.repeat(60));
console.log('');

// Compile contracts
function compileContract(contractPath, contractName) {
  console.log(`Compiling ${contractName}...`);

  const source = readFileSync(contractPath, 'utf8');

  // Find imports and load them
  const sources = {
    [contractName + '.sol']: { content: source }
  };

  // Load IResolver interface
  try {
    const iresolver = readFileSync('contracts/interfaces/IResolver.sol', 'utf8');
    sources['../interfaces/IResolver.sol'] = { content: iresolver };
    sources['IResolver.sol'] = { content: iresolver };
  } catch (e) { }

  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object']
        }
      }
    }
  };

  function findImports(importPath) {
    try {
      // Handle various import path formats
      let fullPath = importPath;
      if (importPath.startsWith('../')) {
        fullPath = 'contracts/' + importPath.replace('../', '');
      } else if (importPath.startsWith('./')) {
        // Same directory import - determine from contract path
        const dir = contractPath.split('/').slice(0, -1).join('/');
        fullPath = dir + '/' + importPath.replace('./', '');
      } else if (!importPath.startsWith('contracts/')) {
        fullPath = 'contracts/' + importPath;
      }
      const content = readFileSync(fullPath, 'utf8');
      return { contents: content };
    } catch (e) {
      return { error: 'File not found: ' + importPath };
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
      console.error('Compilation errors:');
      errors.forEach(e => console.error(e.formattedMessage));
      process.exit(1);
    }
  }

  const contractFile = Object.keys(output.contracts).find(f =>
    output.contracts[f][contractName]
  );

  if (!contractFile || !output.contracts[contractFile][contractName]) {
    console.error(`Contract ${contractName} not found in compilation output`);
    process.exit(1);
  }

  const contract = output.contracts[contractFile][contractName];

  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object
  };
}

async function deploy() {
  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Deployer: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log('');

  if (balance === 0n) {
    console.error('No ETH balance! Please fund the wallet first.');
    process.exit(1);
  }

  const deployed = {
    network: 'Base Mainnet',
    chainId: 8453,
    deployer: wallet.address,
    usdc: USDC_ADDRESS,
    contracts: {},
    timestamp: new Date().toISOString()
  };

  // 1. Deploy ChainlinkResolver
  console.log('[1/3] Deploying ChainlinkResolver...');
  const chainlinkCompiled = compileContract(
    'contracts/resolvers/ChainlinkResolver.sol',
    'ChainlinkResolver'
  );

  const ChainlinkFactory = new ethers.ContractFactory(
    chainlinkCompiled.abi,
    chainlinkCompiled.bytecode,
    wallet
  );

  const chainlinkResolver = await ChainlinkFactory.deploy();
  await chainlinkResolver.waitForDeployment();
  const chainlinkAddress = await chainlinkResolver.getAddress();
  console.log(`   ChainlinkResolver: ${chainlinkAddress}`);

  deployed.contracts.ChainlinkResolver = {
    address: chainlinkAddress,
    abi: chainlinkCompiled.abi
  };

  // 2. Deploy ManualResolver
  console.log('[2/3] Deploying ManualResolver...');
  const manualCompiled = compileContract(
    'contracts/resolvers/ManualResolver.sol',
    'ManualResolver'
  );

  const ManualFactory = new ethers.ContractFactory(
    manualCompiled.abi,
    manualCompiled.bytecode,
    wallet
  );

  const manualResolver = await ManualFactory.deploy();
  await manualResolver.waitForDeployment();
  const manualAddress = await manualResolver.getAddress();
  console.log(`   ManualResolver: ${manualAddress}`);

  deployed.contracts.ManualResolver = {
    address: manualAddress,
    abi: manualCompiled.abi
  };

  // 3. Deploy MarketFactory
  console.log('[3/3] Deploying MarketFactory...');
  const factoryCompiled = compileContract(
    'contracts/core/MarketFactory.sol',
    'MarketFactory'
  );

  const FactoryFactory = new ethers.ContractFactory(
    factoryCompiled.abi,
    factoryCompiled.bytecode,
    wallet
  );

  // Treasury = deployer, Owner = deployer
  const marketFactory = await FactoryFactory.deploy(USDC_ADDRESS, wallet.address, wallet.address);
  await marketFactory.waitForDeployment();
  const factoryAddress = await marketFactory.getAddress();
  console.log(`   MarketFactory: ${factoryAddress}`);

  deployed.contracts.MarketFactory = {
    address: factoryAddress,
    abi: factoryCompiled.abi
  };

  // 4. Approve resolvers
  console.log('');
  console.log('Approving resolvers...');

  const factory = new ethers.Contract(factoryAddress, factoryCompiled.abi, wallet);

  let tx = await factory.setResolverApproval(chainlinkAddress, true);
  await tx.wait();
  console.log(`   ChainlinkResolver approved`);

  tx = await factory.setResolverApproval(manualAddress, true);
  await tx.wait();
  console.log(`   ManualResolver approved`);

  // Save deployment info
  writeFileSync('deployment-mainnet.json', JSON.stringify(deployed, null, 2));
  console.log('');
  console.log('='.repeat(60));
  console.log('DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('Contracts:');
  console.log(`  MarketFactory:     ${factoryAddress}`);
  console.log(`  ChainlinkResolver: ${chainlinkAddress}`);
  console.log(`  ManualResolver:    ${manualAddress}`);
  console.log('');
  console.log('Saved to: deployment-mainnet.json');
  console.log('');

  // Update .env
  console.log('Update your .env with:');
  console.log(`MAINNET_CONTRACT_ADDRESS=${factoryAddress}`);
  console.log(`MAINNET_CHAINLINK_RESOLVER=${chainlinkAddress}`);
  console.log(`MAINNET_MANUAL_RESOLVER=${manualAddress}`);
}

deploy().catch(err => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
