// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

interface ICurveController {
    function setPoolController(address poolController_) external;
    function poolController() external view returns (address);
    function treasury() external view returns (address);
    function sellTeamFee() external view returns (uint256);
    function setSellTeamFee(uint256) external;

    function buyFromCurve(uint256 X_6, uint256 minTokensOut, uint256 deadline) external returns (uint256);
    function redeemFromCurve(uint256 deltaS, uint256 minUsdcOut_6, uint256 deadline) external returns (uint256);
    function buyFromCurveFor(address buyer, uint256 X_18, uint256 minTokensOut, uint256 deadline)
        external
        returns (uint256);
    function setLastBuyTime(address user, uint256 timestamp) external;

    function effectiveMinimalX6() external view returns (uint256);
    function S_curve() external view returns (uint256);
    function reserve() external view returns (uint256);
    function buyFee() external view returns (uint256);
    function redeemFee() external view returns (uint256);
    function minimalPurchase() external view returns (uint256);

    function setBuyFee(uint256) external;
    function setRedeemFee(uint256) external;
    function setEarlySellFee(uint256) external;
    function setEarlySellPeriod(uint256) external;
    function maxPurchasePct() external view returns (uint256);
    function setMaxPurchasePct(uint256) external;
    function setMinimalPurchase(uint256) external;

    function pause() external;
    function unpause() external;
}
