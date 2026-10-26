// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {XartIAToken} from "../../contracts/token/XartIAToken.sol";
import {Roles} from "../../contracts/core/Roles.sol";

/// @title XartIAToken.t.sol — T.1.01.01
contract XartIATokenTest is Test {
    XartIAToken internal token;

    address internal admin = address(0xA11CE);
    address internal minter = address(0xB0B);
    address internal burner = address(0xCAFE);
    address internal user = address(0xD00D);

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    function setUp() public {
        vm.prank(admin);
        token = new XartIAToken();
    }

    // ------------------------------------------------------------------ metadata

    function test_metadata() public view {
        assertEq(token.name(), "XartIA");
        assertEq(token.symbol(), "XRT");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
    }

    function test_constructor_grants_admin() public view {
        assertTrue(token.hasRole(Roles.DEFAULT_ADMIN_ROLE, admin));
    }

    // ------------------------------------------------------------------ mint

    function test_mint() public {
        vm.prank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);

        vm.prank(minter);
        token.mint(user, 100e18);

        assertEq(token.balanceOf(user), 100e18);
        assertEq(token.totalSupply(), 100e18);
    }

    function test_mint_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, user, Roles.MINTER_ROLE)
        );
        token.mint(user, 100e18);
    }

    function test_mint_event() public {
        vm.prank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);

        vm.expectEmit(true, false, false, true);
        emit Mint(user, 100e18);
        vm.prank(minter);
        token.mint(user, 100e18);
    }

    // ------------------------------------------------------------------ burnFrom

    function test_burnFrom() public {
        vm.startPrank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.BURNER_ROLE, burner);
        vm.stopPrank();

        vm.prank(minter);
        token.mint(user, 100e18);

        vm.prank(user);
        token.approve(burner, 50e18);

        vm.prank(burner);
        token.burnFrom(user, 50e18);

        assertEq(token.balanceOf(user), 50e18);
        assertEq(token.totalSupply(), 50e18);
        assertEq(token.allowance(user, burner), 0);
    }

    function test_burnFrom_revert_no_allowance() public {
        vm.startPrank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.BURNER_ROLE, burner);
        vm.stopPrank();

        vm.prank(minter);
        token.mint(user, 100e18);

        // Без approve → OZ v5 ERC20InsufficientAllowance
        vm.prank(burner);
        vm.expectRevert();
        token.burnFrom(user, 50e18);
    }

    function test_burnFrom_revert_insufficient_allowance() public {
        vm.startPrank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.BURNER_ROLE, burner);
        vm.stopPrank();

        vm.prank(minter);
        token.mint(user, 100e18);

        vm.prank(user);
        token.approve(burner, 10e18);

        vm.prank(burner);
        vm.expectRevert();
        token.burnFrom(user, 50e18);
    }

    function test_burnFrom_revert_unauthorized() public {
        vm.prank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        vm.prank(minter);
        token.mint(user, 100e18);

        vm.prank(user);
        token.approve(burner, 100e18);

        // burner не имеет BURNER_ROLE
        vm.prank(burner);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, burner, Roles.BURNER_ROLE)
        );
        token.burnFrom(user, 50e18);
    }

    function test_burn_event() public {
        vm.startPrank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.BURNER_ROLE, burner);
        vm.stopPrank();

        vm.prank(minter);
        token.mint(user, 100e18);
        vm.prank(user);
        token.approve(burner, 100e18);

        vm.expectEmit(true, false, false, true);
        emit Burn(user, 100e18);
        vm.prank(burner);
        token.burnFrom(user, 100e18);
    }

    // ------------------------------------------------------------------ roles

    function test_roles() public {
        assertTrue(token.hasRole(Roles.DEFAULT_ADMIN_ROLE, admin));
        assertFalse(token.hasRole(Roles.MINTER_ROLE, admin));
        assertFalse(token.hasRole(Roles.BURNER_ROLE, admin));
    }

    function test_grantRole() public {
        vm.prank(admin);
        token.grantRole(Roles.MINTER_ROLE, minter);
        assertTrue(token.hasRole(Roles.MINTER_ROLE, minter));

        vm.prank(admin);
        token.grantRole(Roles.BURNER_ROLE, burner);
        assertTrue(token.hasRole(Roles.BURNER_ROLE, burner));
    }

    function test_revert_unauthorized_grantRole() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, user, Roles.DEFAULT_ADMIN_ROLE
            )
        );
        token.grantRole(Roles.MINTER_ROLE, user);
    }

    // ------------------------------------------------------------------ no self-burn

    function test_no_burn_function() public {
        // В ABI не должно быть burn(uint256). Проверяем через low-level call.
        (bool ok,) = address(token).call(abi.encodeWithSignature("burn(uint256)", 1e18));
        assertFalse(ok, "burn(uint256) must not exist");
    }
}
