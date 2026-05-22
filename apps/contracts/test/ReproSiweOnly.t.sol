// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";

interface IFactory {
  struct Params { uint8 mode; address[] custodians; address[] trustees; bytes32 credId; uint256 x; uint256 y; }
  function getAddressForMultiSigSmartAgent(Params calldata p, address v, uint256 s) external view returns (address);
}

contract Repro is Test {
  function test_repro() public {
    vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC"));
    address[] memory custodians = new address[](1);
    custodians[0] = 0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44;
    address[] memory trustees = new address[](0);
    IFactory.Params memory p = IFactory.Params({
      mode: 1, custodians: custodians, trustees: trustees,
      credId: bytes32(0), x: 0, y: 0
    });
    address a = IFactory(0xD8CFaD42c2B1AFDf585764754ae25DCf6090ab29)
      .getAddressForMultiSigSmartAgent(p, 0x11c89B42513CaF67f6ed7e3d14088e2E744B7532, 4711729916260085614);
    emit log_address(a);
  }
}
